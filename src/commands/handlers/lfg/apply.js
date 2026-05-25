const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const db = require('../../../db');
const { sessionSet, sessionGet, sessionDelete, fetchChannel } = require('../../../utils');

// ── In-memory: userId → { lfgId, selectedCharIds } ───────────────────────────
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

  sessionSet(sessions, interaction.user.id, { lfgId, selectedCharIds: [] });

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

  await interaction.reply({
    content: `**Bewerbung für ${group.dungeon} +${group.key_level}**\nWähle die Charaktere, mit denen du spielen möchtest.`,
    components: [
      new ActionRowBuilder().addComponents(charSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lfgapply_confirm').setLabel('Bewerben').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lfgapply_cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  });
}

// ── Character select update ───────────────────────────────────────────────────
async function handleApplySelect(interaction) {
  const session = sessionGet(sessions, interaction.user.id);
  if (!session) {
    return interaction.update({ content: '❌ Sitzung abgelaufen. Klicke erneut auf Bewerben.', components: [] });
  }
  session.selectedCharIds = interaction.values.map(v => parseInt(v, 10));
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

  const { lfgId, selectedCharIds } = session;
  sessionDelete(sessions, interaction.user.id);

  // Re-check group is still open
  const group = await db.getLfgGroup(lfgId);
  if (!group || group.status !== 'open') {
    return interaction.editReply({ content: '❌ Diese LFG-Gruppe ist nicht mehr offen.', components: [] });
  }

  const spotsLeft = await db.getLfgSpotsLeft(lfgId);
  if (spotsLeft <= 0) {
    return interaction.editReply({ content: '❌ Diese Gruppe ist bereits voll.', components: [] });
  }

  // Create application in DB
  const appId = await db.createApplication({
    lfgId,
    applicantId: interaction.user.id,
    charIds:     selectedCharIds,
  });

  // Fetch char info for the card
  const charRows = await Promise.all(selectedCharIds.map(id => db.getCharacterById(id)));
  const validChars = charRows.filter(Boolean);
  const charLines  = validChars.map(c => `• ${c.char_name} — ${c.realm} (${c.class ?? '?'} / ${c.spec ?? '?'} • ${c.rio_score ?? 0} IO)`).join('\n');

  // Post application card in keyholder's mgmt channel
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
      { name: 'Spieler',     value: `${interaction.user}`,  inline: true },
      { name: 'Charaktere',  value: charLines || '—',        inline: false },
    )
    .setFooter({ text: `Bewerbungs-ID: ${appId}` })
    .setTimestamp();

  const mgmtMsg = await mgmtChannel.send({
    embeds:     [appEmbed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`lfgapprove_${appId}`)
          .setLabel('Annehmen')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`lfgreject_${appId}`)
          .setLabel('Ablehnen')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  });

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

// Stub for /lfg apply command (kept as fallback)
async function execute(interaction) {
  await interaction.reply({ content: '💡 Nutze den **Bewerben**-Button in den LFG-Channels.', ephemeral: true });
}

module.exports = { execute, handleApplyButton, handleApplySelect, handleApplyConfirm, handleApplyCancel };
