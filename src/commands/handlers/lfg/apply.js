const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const db = require('../../../db');
const { sessionSet, sessionGet, sessionDelete, fetchChannel } = require('../../../utils');

const ROLE_LABELS = { tank: '🛡️ Tank', healer: '💚 Healer', dps: '⚔️ DPS' };

// Channel-id → role, built lazily from env vars
function channelRoleFromId(channelId) {
  if (process.env.CHANNEL_TANK_LFG   === channelId) return 'tank';
  if (process.env.CHANNEL_HEALER_LFG === channelId) return 'healer';
  if (process.env.CHANNEL_DPS_LFG    === channelId) return 'dps';
  return null;
}

// ── In-memory: userId → { lfgId, selectedCharIds, selectedRoles } ─────────────
const sessions = new Map();

// ── "Bewerben" button on announcement ────────────────────────────────────────
async function handleApplyButton(interaction) {
  const lfgId = parseInt(interaction.customId.split('_')[1], 10);
  const group  = await db.getLfgGroup(lfgId);

  if (!group || group.status !== 'open') {
    return interaction.reply({ content: '❌ Diese LFG-Gruppe ist nicht mehr offen.', ephemeral: true });
  }
  if (group.creator_id === interaction.user.id) {
    return interaction.reply({ content: '❌ Du kannst dich nicht für deine eigene LFG bewerben.', ephemeral: true });
  }

  const existing = await db.getExistingApplication(lfgId, interaction.user.id);
  if (existing) {
    return interaction.reply({ content: '❌ Du hast dich bereits für diese LFG beworben.', ephemeral: true });
  }

  const spotsLeft = await db.getLfgSpotsLeft(lfgId);
  if (spotsLeft <= 0) {
    return interaction.reply({ content: '❌ Diese Gruppe ist bereits voll.', ephemeral: true });
  }

  const chars = await db.getCharacters(interaction.user.id);
  if (!chars.length) {
    return interaction.reply({
      content: '❌ Du hast keine Charaktere registriert. Nutze `/rio addmain` zuerst.',
      ephemeral: true,
    });
  }

  const preselectedRole = channelRoleFromId(interaction.channelId);
  sessionSet(sessions, interaction.user.id, {
    lfgId,
    selectedCharIds: [],
    selectedRoles:   preselectedRole && group.roles_wanted.includes(preselectedRole) ? [preselectedRole] : [],
  });

  const charSelect = new StringSelectMenuBuilder()
    .setCustomId('lfgapply_chars')
    .setPlaceholder('Welche Chars möchtest du anbieten?')
    .setMinValues(1)
    .setMaxValues(Math.min(chars.length, 25))
    .addOptions(chars.slice(0, 25).map(c => ({
      label:       `${c.char_name} — ${c.realm}`,
      description: `${c.class ?? '?'} • ${c.rio_score ?? 0} IO`,
      value:       String(c.id),
    })));

  // Only show roles the keyholder is looking for; pre-select based on source channel
  const roleOptions = group.roles_wanted.map(r => ({
    label:   ROLE_LABELS[r] ?? r,
    value:   r,
    default: r === preselectedRole,
  }));

  const roleSelect = new StringSelectMenuBuilder()
    .setCustomId('lfgapply_roles')
    .setPlaceholder('Welche Rolle(n) kannst du spielen?')
    .setMinValues(1)
    .setMaxValues(roleOptions.length)
    .addOptions(roleOptions);

  await interaction.reply({
    content: `**Bewerbung für ${group.dungeon} +${group.key_level}**\nWähle deine Charaktere und die Rolle(n), die du spielen kannst.`,
    components: [
      new ActionRowBuilder().addComponents(charSelect),
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lfgapply_confirm').setLabel('Bewerben').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lfgapply_cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  });
}

// ── Select menu updates ───────────────────────────────────────────────────────
async function handleApplySelect(interaction) {
  const session = sessionGet(sessions, interaction.user.id);
  if (!session) {
    return interaction.update({ content: '❌ Sitzung abgelaufen. Klicke erneut auf Bewerben.', components: [] });
  }
  if (interaction.customId === 'lfgapply_chars') {
    session.selectedCharIds = interaction.values.map(v => parseInt(v, 10));
  } else if (interaction.customId === 'lfgapply_roles') {
    session.selectedRoles = interaction.values;
  }
  await interaction.deferUpdate();
}

// ── Confirm application ───────────────────────────────────────────────────────
async function handleApplyConfirm(interaction) {
  const session = sessionGet(sessions, interaction.user.id);
  if (!session) {
    return interaction.update({ content: '❌ Sitzung abgelaufen. Klicke erneut auf Bewerben.', components: [] });
  }

  await interaction.deferUpdate();

  if (!session.selectedCharIds.length) {
    return interaction.followUp({ content: '❌ Bitte wähle mindestens einen Charakter aus.', ephemeral: true });
  }
  if (!session.selectedRoles.length) {
    return interaction.followUp({ content: '❌ Bitte wähle mindestens eine Rolle aus.', ephemeral: true });
  }

  const { lfgId, selectedCharIds, selectedRoles } = session;
  sessionDelete(sessions, interaction.user.id);

  const group = await db.getLfgGroup(lfgId);
  if (!group || group.status !== 'open') {
    return interaction.editReply({ content: '❌ Diese LFG-Gruppe ist nicht mehr offen.', components: [] });
  }

  const spotsLeft = await db.getLfgSpotsLeft(lfgId);
  if (spotsLeft <= 0) {
    return interaction.editReply({ content: '❌ Diese Gruppe ist bereits voll.', components: [] });
  }

  const appId = await db.createApplication({
    lfgId,
    applicantId:  interaction.user.id,
    charIds:      selectedCharIds,
    rolesOffered: selectedRoles,
  });

  const charRows   = await Promise.all(selectedCharIds.map(id => db.getCharacterById(id)));
  const validChars = charRows.filter(Boolean);
  const charLines  = validChars.map(c => `• ${c.char_name} — ${c.realm} (${c.class ?? '?'} / ${c.spec ?? '?'} • ${c.rio_score ?? 0} IO)`).join('\n');
  const rolesText  = selectedRoles.map(r => ROLE_LABELS[r] ?? r).join(', ');

  const guild      = interaction.guild;
  const mgmtChannel = await fetchChannel(guild, group.mgmt_channel_id);
  if (!mgmtChannel) {
    console.warn(`Mgmt channel ${group.mgmt_channel_id} not found for LFG ${lfgId}`);
    return interaction.editReply({ content: '❌ Management-Channel nicht gefunden.', components: [] });
  }

  const appEmbed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('Neue Bewerbung')
    .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL() })
    .addFields(
      { name: 'Spieler',    value: `${interaction.user}`, inline: true },
      { name: 'Rolle(n)',   value: rolesText,              inline: true },
      { name: 'Charaktere', value: charLines || '—',       inline: false },
    )
    .setFooter({ text: `Bewerbungs-ID: ${appId}` })
    .setTimestamp();

  const cardComponents = [];

  if (selectedRoles.length > 1) {
    cardComponents.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`lfgapproverolesel_${appId}`)
          .setPlaceholder('Welche Rolle soll der Spieler übernehmen?')
          .addOptions(selectedRoles.map((r, i) => ({
            label:   ROLE_LABELS[r] ?? r,
            value:   r,
            default: i === 0,
          }))),
      ),
    );
  }

  cardComponents.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`lfgapprove_${appId}`).setLabel('Annehmen').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`lfgreject_${appId}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
    ),
  );

  const mgmtMsg = await mgmtChannel.send({ embeds: [appEmbed], components: cardComponents });

  await db.setApplicationMgmtMsg(appId, mgmtMsg.id);

  await interaction.editReply({
    content: '✅ Bewerbung abgeschickt! Der Keyholder wird dich benachrichtigen.',
    components: [],
  });
}

// ── Cancel application flow ───────────────────────────────────────────────────
async function handleApplyCancel(interaction) {
  sessionDelete(sessions, interaction.user.id);
  await interaction.update({ content: '❌ Bewerbung abgebrochen.', components: [] });
}

async function execute(interaction) {
  await interaction.reply({ content: '💡 Nutze den **Bewerben**-Button in den LFG-Channels.', ephemeral: true });
}

module.exports = { execute, handleApplyButton, handleApplySelect, handleApplyConfirm, handleApplyCancel };
