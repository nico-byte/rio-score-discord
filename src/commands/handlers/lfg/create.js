const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');
const db = require('../../../db');

// ── Static data ───────────────────────────────────────────────────────────────
// Update DUNGEONS each season
const DUNGEONS = [
  'Ara-Kara, City of Echoes',
  'City of Threads',
  'Grim Batol',
  'The Dawnbreaker',
  'Mists of Tirna Scithe',
  'The Necrotic Wake',
  'Siege of Boralus',
  'Stonevault',
  'Cinderbrew Meadery',
  'Darkflame Cleft',
  'Operation: Floodgate',
  'Priory of the Sacred Flame',
  'The MOTHERLODE!!',
  'The Rookery',
  'Operation: Mechagon - Workshop',
  'Theater of Pain',
];

// +2 through +25 (24 options, within Discord's 25-option limit)
const KEY_LEVELS = Array.from({ length: 24 }, (_, i) => String(i + 2));

const SCORE_OPTIONS = [
  { label: 'Keine Anforderung',    value: 'none',     emoji: '⚪' },
  { label: 'Pusher 3k+',          value: 'pusher',   emoji: '🟠' },
  { label: 'Extreme Pusher 3.5k+', value: 'extreme',  emoji: '🟤' },
  { label: 'Hardcore Pusher 4k+',  value: 'hardcore', emoji: '🟣' },
];
const SCORE_LABELS = {
  none:     '⚪ Keine Anforderung',
  pusher:   '🟠 Pusher 3k+',
  extreme:  '🟤 Extreme Pusher 3.5k+',
  hardcore: '🟣 Hardcore Pusher 4k+',
};
const ROLE_CHANNELS = {
  tank:   { envKey: 'CHANNEL_TANK_LFG',   color: 0x3498db, label: 'Tank' },
  healer: { envKey: 'CHANNEL_HEALER_LFG', color: 0x2ecc71, label: 'Healer' },
  dps:    { envKey: 'CHANNEL_DPS_LFG',    color: 0xe74c3c, label: 'DPS' },
};

// ── Session state: userId → { dungeon, keyLevel, characterId, roles, scoreReq, chars } ──
const sessions = new Map();

// ── Step 1: /lfg create → show dungeon + key level selects ───────────────────
async function showStep1(interaction) {
  const chars = await db.getCharacters(interaction.user.id);
  if (!chars.length) {
    return interaction.reply({
      content: '❌ Du hast keine Charaktere registriert. Nutze `/rio addmain` zuerst.',
      ephemeral: true,
    });
  }

  const defaultChar = chars.find(c => c.is_active) ?? chars[0];
  sessions.set(interaction.user.id, {
    dungeon:     DUNGEONS[0],
    keyLevel:    '2',
    characterId: String(defaultChar.id),
    roles:       [],
    scoreReq:    'none',
    chars,
  });

  const dungeonSelect = new StringSelectMenuBuilder()
    .setCustomId('lfgcreate_dungeon')
    .setPlaceholder('Dungeon wählen')
    .addOptions(DUNGEONS.map((d, i) => ({ label: d, value: d, default: i === 0 })));

  const keySelect = new StringSelectMenuBuilder()
    .setCustomId('lfgcreate_keylevel')
    .setPlaceholder('Key Level wählen')
    .addOptions(KEY_LEVELS.map((l, i) => ({ label: `+${l}`, value: l, default: i === 0 })));

  await interaction.reply({
    content: '**LFG Gruppe erstellen — Schritt 1/2**\nWähle Dungeon und Key Level.',
    components: [
      new ActionRowBuilder().addComponents(dungeonSelect),
      new ActionRowBuilder().addComponents(keySelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lfgcreate_next').setLabel('Weiter →').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('lfgcreate_cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  });
}

// ── Step 2: "Weiter" button → show char + role + score selects ────────────────
async function showStep2(interaction) {
  const session = sessions.get(interaction.user.id);
  if (!session) {
    return interaction.update({ content: '❌ Sitzung abgelaufen. Bitte `/lfg create` erneut nutzen.', components: [] });
  }

  const { dungeon, keyLevel, characterId, scoreReq, chars } = session;
  const charOptions = chars.slice(0, 25).map(c => ({
    label:       `${c.char_name} — ${c.realm}`,
    description: `${c.class ?? '?'} • ${c.rio_score ?? 0} IO`,
    value:       String(c.id),
    default:     String(c.id) === characterId,
  }));

  const charSelect = new StringSelectMenuBuilder()
    .setCustomId('lfgcreate_char')
    .setPlaceholder('Welchen Char spielst du?')
    .addOptions(charOptions);

  const roleSelect = new StringSelectMenuBuilder()
    .setCustomId('lfgcreate_roles')
    .setPlaceholder('Wen suchst du? (Mehrfachauswahl)')
    .setMinValues(1)
    .setMaxValues(3)
    .addOptions([
      { label: 'Tank',   value: 'tank',   emoji: '🛡️' },
      { label: 'Healer', value: 'healer', emoji: '💚' },
      { label: 'DPS',    value: 'dps',    emoji: '⚔️' },
    ]);

  const scoreSelect = new StringSelectMenuBuilder()
    .setCustomId('lfgcreate_score')
    .setPlaceholder('Score-Anforderung')
    .addOptions(SCORE_OPTIONS.map(o => ({
      label:   `${o.emoji} ${o.label}`,
      value:   o.value,
      default: o.value === scoreReq,
    })));

  await interaction.update({
    content: `**LFG: ${dungeon} +${keyLevel} — Schritt 2/2**\nWähle deinen Char, wen du suchst und die Score-Anforderung.`,
    components: [
      new ActionRowBuilder().addComponents(charSelect),
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(scoreSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lfgcreate_confirm').setLabel('Gruppe erstellen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lfgcreate_cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

// ── Select menu updates ───────────────────────────────────────────────────────
async function handleSelect(interaction) {
  const session = sessions.get(interaction.user.id);
  if (!session) {
    return interaction.update({ content: '❌ Sitzung abgelaufen. Bitte `/lfg create` erneut nutzen.', components: [] });
  }

  if (interaction.customId === 'lfgcreate_dungeon')  session.dungeon     = interaction.values[0];
  if (interaction.customId === 'lfgcreate_keylevel') session.keyLevel    = interaction.values[0];
  if (interaction.customId === 'lfgcreate_char')     session.characterId = interaction.values[0];
  if (interaction.customId === 'lfgcreate_roles')    session.roles       = interaction.values;
  if (interaction.customId === 'lfgcreate_score')    session.scoreReq    = interaction.values[0];

  await interaction.deferUpdate();
}

// ── Confirm button ────────────────────────────────────────────────────────────
async function handleConfirm(interaction) {
  const session = sessions.get(interaction.user.id);
  if (!session) {
    return interaction.update({ content: '❌ Sitzung abgelaufen. Bitte `/lfg create` erneut nutzen.', components: [] });
  }

  await interaction.deferUpdate();

  if (!session.roles.length) {
    return interaction.followUp({ content: '❌ Bitte wähle mindestens eine gesuchte Rolle aus.', ephemeral: true });
  }

  sessions.delete(interaction.user.id);

  const { dungeon, keyLevel, characterId, roles, scoreReq } = session;
  const char       = await db.getCharacterById(parseInt(characterId, 10));
  const scoreLabel = SCORE_LABELS[scoreReq];
  const guild      = interaction.guild;

  // Validate parent category
  const parentId      = process.env.LFG_CATEGORY_ID ?? null;
  const parentChannel = parentId ? guild.channels.cache.get(parentId) : null;
  const resolvedParent = parentChannel?.type === ChannelType.GuildCategory ? parentId : null;
  if (parentId && !resolvedParent) {
    console.warn(`LFG_CATEGORY_ID (${parentId}) is not a category — creating channel without parent`);
  }

  const channelName = `lfg-${dungeon.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-')}-${keyLevel}`
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 100);

  const lfgChannel = await guild.channels.create({
    name:   channelName,
    type:   ChannelType.GuildText,
    parent: resolvedParent,
    topic:  `LFG: ${dungeon} +${keyLevel} | ${char.char_name} sucht: ${roles.join(', ')} | ${scoreLabel}`,
  });

  // Pin group info in the new channel
  const infoEmbed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`LFG: ${dungeon} +${keyLevel}`)
    .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL() })
    .addFields(
      { name: 'Dungeon',       value: dungeon,                                                              inline: true },
      { name: 'Key Level',     value: `+${keyLevel}`,                                                       inline: true },
      { name: 'Charakter',     value: `${char.char_name} — ${char.realm} (${char.region?.toUpperCase()})`, inline: false },
      { name: 'Klasse / Spec', value: `${char.class ?? '?'} / ${char.spec ?? '?'}`,                        inline: true },
      { name: 'Mein Score',    value: `${char.rio_score ?? 0} IO`,                                         inline: true },
      { name: 'Gesucht',       value: roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', '),  inline: false },
      { name: 'Anforderung',   value: scoreLabel,                                                           inline: false },
    )
    .setTimestamp();

  const pinMsg = await lfgChannel.send({ embeds: [infoEmbed] });
  await pinMsg.pin().catch(() => {});

  // Announce in each requested role channel
  for (const role of roles) {
    const mapping = ROLE_CHANNELS[role];
    if (!mapping) continue;
    const targetChannel = guild.channels.cache.get(process.env[mapping.envKey]);
    if (!targetChannel) continue;

    const announceEmbed = new EmbedBuilder()
      .setColor(mapping.color)
      .setTitle(`LFG: ${mapping.label} gesucht!`)
      .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL() })
      .addFields(
        { name: 'Dungeon',        value: dungeon,        inline: true },
        { name: 'Key Level',      value: `+${keyLevel}`, inline: true },
        { name: 'Anforderung',    value: scoreLabel,      inline: false },
        { name: 'Details & Join', value: `[👉 Zum LFG-Channel](${lfgChannel.url})`, inline: false },
      )
      .setFooter({ text: 'Wird automatisch nach 1 Stunde gelöscht' })
      .setTimestamp();

    const announced = await targetChannel.send({ embeds: [announceEmbed] });
    setTimeout(() => announced.delete().catch(() => {}), 60 * 60 * 1000);
  }

  await interaction.editReply({
    content: `✅ LFG-Channel erstellt: ${lfgChannel}`,
    components: [],
  });
}

// ── Cancel button ─────────────────────────────────────────────────────────────
async function handleCancel(interaction) {
  sessions.delete(interaction.user.id);
  await interaction.update({ content: '❌ LFG abgebrochen.', components: [] });
}

module.exports = { showStep1, handleSelect, showStep2, handleConfirm, handleCancel };
