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

// Channel-id → role, built from env vars
function channelRoleFromId(channelId) {
  if (process.env.CHANNEL_TANK_LFG   === channelId) return 'tank';
  if (process.env.CHANNEL_HEALER_LFG === channelId) return 'healer';
  if (process.env.CHANNEL_DPS_LFG    === channelId) return 'dps';
  return null;
}

function getRoleScore(char, role) {
  if (role === 'tank')   return char.score_tank   || char.rio_score || 0;
  if (role === 'healer') return char.score_healer || char.rio_score || 0;
  if (role === 'dps')    return char.score_dps    || char.rio_score || 0;
  return char.rio_score || 0;
}

function roleOptionDesc(char, role) {
  const score = getRoleScore(char, role);
  const key   = char.highest_key || 0;
  return `${char.char_name} • ${score.toLocaleString('de-DE')} IO${key ? ` • Höchster Key: +${key}` : ''}`;
}

function pairOptionDesc(char, role) {
  const score = getRoleScore(char, role);
  const key   = char.highest_key || 0;
  return `${char.class ?? '?'} / ${char.spec ?? '?'} • ${score.toLocaleString('de-DE')} IO${key ? ` • +${key}` : ''}`;
}

// ── In-memory: userId → { lfgId, preselectedRole, selectedCharIds, charRoles } ──
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

  const rawPreselect    = channelRoleFromId(interaction.channelId);
  const preselectedRole = rawPreselect && group.roles_wanted.includes(rawPreselect) ? rawPreselect : null;

  sessionSet(sessions, interaction.user.id, {
    lfgId,
    preselectedRole,
    selectedCharIds: [],
    charRoles: {},
  });

  // Max 4 chars so we can fit one role row per char + one button row (5 rows total)
  const charSelect = new StringSelectMenuBuilder()
    .setCustomId('lfgapply_chars')
    .setPlaceholder('Welche Chars möchtest du anbieten?')
    .setMinValues(1)
    .setMaxValues(Math.min(chars.length, 4))
    .addOptions(chars.slice(0, 25).map(c => ({
      label:       `${c.char_name} — ${c.realm}`,
      description: `${c.class ?? '?'} • ${c.rio_score ?? 0} IO`,
      value:       String(c.id),
    })));

  await interaction.reply({
    content: `**Bewerbung für ${group.dungeon} +${group.key_level}**\nWähle deine Charaktere.`,
    components: [
      new ActionRowBuilder().addComponents(charSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lfgapply_next').setLabel('Weiter →').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('lfgapply_cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  });
}

// ── "Weiter" button: show per-char role dropdowns ────────────────────────────
async function handleApplyNext(interaction) {
  const session = sessionGet(sessions, interaction.user.id);
  if (!session) {
    return interaction.update({ content: '❌ Sitzung abgelaufen. Klicke erneut auf Bewerben.', components: [] });
  }
  if (!session.selectedCharIds.length) {
    return interaction.reply({ content: '❌ Bitte wähle mindestens einen Charakter aus.', ephemeral: true });
  }

  const group = await db.getLfgGroup(session.lfgId);
  if (!group || group.status !== 'open') {
    sessionDelete(sessions, interaction.user.id);
    return interaction.update({ content: '❌ Diese LFG-Gruppe ist nicht mehr offen.', components: [] });
  }

  const charIds  = session.selectedCharIds.slice(0, 4);
  const charRows = await Promise.all(charIds.map(id => db.getCharacterById(id)));
  const chars    = charRows.filter(Boolean);

  // Pre-populate charRoles with preselectedRole (or first available role) for each char
  for (const char of chars) {
    if (!session.charRoles[String(char.id)]) {
      session.charRoles[String(char.id)] = session.preselectedRole ?? group.roles_wanted[0];
    }
  }

  const roleRows = chars.map(char => {
    const currentRole = session.charRoles[String(char.id)];
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`lfgapply_role_${char.id}`)
        .setPlaceholder(`${char.char_name}: Welche Rolle?`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(group.roles_wanted.map(r => ({
          label:       ROLE_LABELS[r] ?? r,
          description: roleOptionDesc(char, r),
          value:       r,
          default:     r === currentRole,
        }))),
    );
  });

  await interaction.update({
    content: `**Bewerbung für ${group.dungeon} +${group.key_level}**\nWelche Rolle spielst du auf jedem Charakter?`,
    components: [
      ...roleRows,
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lfgapply_confirm').setLabel('Bewerben').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lfgapply_cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      ),
    ],
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
  } else if (interaction.customId.startsWith('lfgapply_role_')) {
    const charId = interaction.customId.split('_')[2];
    session.charRoles[charId] = interaction.values[0];
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

  const charIds       = session.selectedCharIds.slice(0, 4);
  const charRolesPairs = charIds.map(charId => ({
    charId,
    role: session.charRoles[String(charId)] ?? null,
  }));

  if (!charRolesPairs.length) {
    return interaction.followUp({ content: '❌ Bitte wähle mindestens einen Charakter aus.', ephemeral: true });
  }
  if (charRolesPairs.some(p => !p.role)) {
    return interaction.followUp({ content: '❌ Bitte wähle für jeden Charakter eine Rolle aus.', ephemeral: true });
  }

  const { lfgId } = session;
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
    applicantId: interaction.user.id,
    charRoles:   charRolesPairs,
  });

  // Fetch char data for the mgmt card
  const charData = await Promise.all(charRolesPairs.map(p => db.getCharacterById(p.charId)));
  const validPairs = charRolesPairs.filter((_, i) => charData[i]);

  const charLines = validPairs.map((pair, i) => {
    const char  = charData[i];
    const score = getRoleScore(char, pair.role);
    const key   = char.highest_key || 0;
    return `• **${char.char_name}** — ${char.realm} (${char.class ?? '?'} / ${char.spec ?? '?'} • ${ROLE_LABELS[pair.role] ?? pair.role} • ${score.toLocaleString('de-DE')} IO${key ? ` • +${key}` : ''})`;
  }).join('\n');

  const guild       = interaction.guild;
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
      { name: 'Spieler',   value: `${interaction.user}`, inline: true },
      { name: 'Angebote',  value: charLines || '—',       inline: false },
    )
    .setFooter({ text: `Bewerbungs-ID: ${appId}` })
    .setTimestamp();

  // Build select options for keyholder to pick which char+role to approve
  const pairOptions = validPairs.map((pair, i) => {
    const char      = charData[i];
    const roleScore = getRoleScore(char, pair.role);
    return {
      label:       `${char.char_name} — ${ROLE_LABELS[pair.role] ?? pair.role}`,
      description: pairOptionDesc(char, pair.role),
      value:       `${pair.charId}:${pair.role}`,
      default:     i === 0,
    };
  });

  const cardComponents = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`lfgapproverolesel_${appId}`)
        .setPlaceholder('Welchen Char / Welche Rolle annehmen?')
        .addOptions(pairOptions),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`lfgapprove_${appId}`).setLabel('Annehmen').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`lfgreject_${appId}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
    ),
  ];

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

module.exports = { execute, handleApplyButton, handleApplyNext, handleApplySelect, handleApplyConfirm, handleApplyCancel };
