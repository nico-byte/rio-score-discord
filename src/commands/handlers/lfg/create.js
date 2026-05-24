const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');
const db = require('../../../db');

// userId → { dungeon, keyLevel, characterId, roles, scoreReq }
const sessions = new Map();

const SCORE_OPTIONS = [
  { label: 'Keine Anforderung', value: 'none',     emoji: '⚪' },
  { label: 'Pusher 3k+',        value: 'pusher',   emoji: '🟠' },
  { label: 'Extreme Pusher 3.5k+', value: 'extreme', emoji: '🟤' },
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

// ── Step 1: open the modal ────────────────────────────────────────────────────
async function openModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('lfgcreate_modal')
    .setTitle('LFG Gruppe erstellen')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dungeon')
          .setLabel('Dungeon')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('z.B. Brackenhide Hollow')
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('keylevel')
          .setLabel('Key Level')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('z.B. 22')
          .setMaxLength(3)
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);
}

// ── Step 2: modal submit → show selects ──────────────────────────────────────
async function handleModal(interaction) {
  const dungeon  = interaction.fields.getTextInputValue('dungeon').trim();
  const keyLevel = interaction.fields.getTextInputValue('keylevel').trim().replace(/^\+/, '');

  await interaction.deferReply({ ephemeral: true });

  const chars = await db.getCharacters(interaction.user.id);
  if (!chars.length) {
    return interaction.editReply('❌ Du hast keine Charaktere registriert. Nutze `/rio addmain` zuerst.');
  }

  // Pre-select active char (or first one)
  const defaultChar = chars.find(c => c.is_active) ?? chars[0];

  sessions.set(interaction.user.id, {
    dungeon,
    keyLevel,
    characterId: String(defaultChar.id),
    roles:       [],
    scoreReq:    'none',
  });

  const charOptions = chars.slice(0, 25).map(c => ({
    label:       `${c.char_name} — ${c.realm}`,
    description: `${c.class ?? '?'} • ${c.rio_score ?? 0} IO`,
    value:       String(c.id),
    default:     c.id === defaultChar.id,
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
    .addOptions(SCORE_OPTIONS.map(o => ({ label: `${o.emoji} ${o.label}`, value: o.value, default: o.value === 'none' })));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lfgcreate_confirm')
      .setLabel('Gruppe erstellen')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('lfgcreate_cancel')
      .setLabel('Abbrechen')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({
    content: `**LFG: ${dungeon} +${keyLevel}**\nWähle deinen Charakter, wen du suchst und die Score-Anforderung.`,
    components: [
      new ActionRowBuilder().addComponents(charSelect),
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(scoreSelect),
      buttons,
    ],
  });
}

// ── Select menu updates ───────────────────────────────────────────────────────
async function handleSelect(interaction) {
  const session = sessions.get(interaction.user.id);
  if (!session) return interaction.update({ content: '❌ Sitzung abgelaufen. Bitte `/lfg create` erneut nutzen.', components: [] });

  if (interaction.customId === 'lfgcreate_char')  session.characterId = interaction.values[0];
  if (interaction.customId === 'lfgcreate_roles') session.roles       = interaction.values;
  if (interaction.customId === 'lfgcreate_score') session.scoreReq    = interaction.values[0];

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
  const char        = await db.getCharacterById(parseInt(characterId, 10));
  const scoreLabel  = SCORE_LABELS[scoreReq];
  const guild       = interaction.guild;

  // Create the LFG text channel
  const channelName = `lfg-${dungeon.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${keyLevel}`
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 100);

  const lfgChannel = await guild.channels.create({
    name:   channelName,
    type:   ChannelType.GuildText,
    parent: process.env.LFG_CATEGORY_ID ?? null,
    topic:  `LFG: ${dungeon} +${keyLevel} | ${char.char_name} sucht: ${roles.join(', ')} | ${scoreLabel}`,
  });

  // Pin group info in the new channel
  const infoEmbed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`LFG: ${dungeon} +${keyLevel}`)
    .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL() })
    .addFields(
      { name: 'Dungeon',         value: dungeon,                                                                  inline: true },
      { name: 'Key Level',       value: `+${keyLevel}`,                                                           inline: true },
      { name: 'Charakter',       value: `${char.char_name} — ${char.realm} (${char.region?.toUpperCase()})`,      inline: false },
      { name: 'Klasse / Spec',   value: `${char.class ?? '?'} / ${char.spec ?? '?'}`,                            inline: true },
      { name: 'Mein Score',      value: `${char.rio_score ?? 0} IO`,                                             inline: true },
      { name: 'Gesucht',         value: roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', '),       inline: false },
      { name: 'Anforderung',     value: scoreLabel,                                                               inline: false },
    )
    .setTimestamp();

  const pinMsg = await lfgChannel.send({ embeds: [infoEmbed] });
  await pinMsg.pin().catch(() => {});

  // Post announcement to each requested role channel
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
        { name: 'Dungeon',     value: dungeon,          inline: true },
        { name: 'Key Level',   value: `+${keyLevel}`,   inline: true },
        { name: 'Anforderung', value: scoreLabel,        inline: false },
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

module.exports = { openModal, handleModal, handleSelect, handleConfirm, handleCancel };
