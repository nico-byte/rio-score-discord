const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db                       = require('../../db');
const { applyRolesFromActive } = require('../../roles');

// ── Rate limiting ─────────────────────────────────────────────────────────────
const _showTimestamps = new Map();
const SHOW_COOLDOWN_MS = 5_000;

function checkShowRateLimit(userId) {
  const last = _showTimestamps.get(userId);
  const now  = Date.now();
  if (last && now - last < SHOW_COOLDOWN_MS) {
    return Math.ceil((SHOW_COOLDOWN_MS - (now - last)) / 1000);
  }
  _showTimestamps.set(userId, now);
  return 0;
}

// ── Timeout tracking ──────────────────────────────────────────────────────────
const activeTimeouts = new Map();
const TIMEOUT_MS = 3 * 60 * 1000;

function resetTimeout(userId, interaction) {
  const existing = activeTimeouts.get(userId);
  if (existing) clearTimeout(existing.timeout);

  const timeout = setTimeout(async () => {
    activeTimeouts.delete(userId);
    try {
      await interaction.editReply({
        content: '⏱️ Sitzung abgelaufen. Nutze `/rio show` erneut.',
        embeds: [],
        components: [],
      });
    } catch (_) {}
  }, TIMEOUT_MS);

  activeTimeouts.set(userId, { timeout, interaction });
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const remaining = checkShowRateLimit(interaction.user.id);
  if (remaining > 0) {
    return interaction.editReply(`❌ Bitte warte noch **${remaining} Sekunde${remaining === 1 ? '' : 'n'}**, bevor du erneut /rio show nutzt.`);
  }

  await showSheet(interaction, 0);
}

// ── Build and send/edit the character sheet for a given index ─────────────────
async function showSheet(interaction, index) {
  const characters = await db.getCharacters(interaction.user.id);

  if (!characters.length) {
    return interaction.editReply({
      embeds: [], components: [],
      content: 'Du hast noch keine Charaktere. Nutze `/rio addmain` oder `/rio addalt`.',
    });
  }

  const i     = Math.max(0, Math.min(index, characters.length - 1));
  const char  = characters[i];
  const total = characters.length;

  const score      = char.rio_score ? Number(char.rio_score).toLocaleString('de-DE') + ' IO' : '—';
  const profileUrl = char.class
    ? `https://raider.io/characters/${char.region}/${char.realm}/${char.char_name}`
    : null;

  const embed = new EmbedBuilder()
    .setColor(char.is_active ? 0x2ecc71 : 0x95a5a6)
    .setTitle(`${char.is_active ? '✅' : '⬜'} ${char.char_name}`)
    .setURL(profileUrl)
    .addFields(
      { name: 'Realm',           value: `${char.realm} (${char.region.toUpperCase()})`, inline: true },
      { name: 'Klasse',          value: char.class ?? '—',                              inline: true },
      { name: 'Spezialisierung', value: char.spec  ?? '—',                              inline: true },
      { name: 'M+ Score',        value: `**${score}**`,                                 inline: true },
      { name: 'Status',          value: char.is_active ? '✅ Aktiv' : '⬜ Inaktiv',      inline: true },
    )
    .setFooter({ text: `Charakter ${i + 1} von ${total}  •  Schließt nach 3 Minuten Inaktivität` });

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rioshow_prev_${i}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(i === 0),
    new ButtonBuilder()
      .setCustomId(`rioshow_next_${i}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(i === total - 1),
  );

  const actionRow = new ActionRowBuilder().addComponents(
    char.is_active
      ? new ButtonBuilder()
          .setCustomId(`rioshow_deactivate_${char.id}_${i}`)
          .setLabel('Deaktivieren')
          .setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder()
          .setCustomId(`rioshow_activate_${char.id}_${i}`)
          .setLabel('Aktivieren')
          .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rioshow_delete_${char.id}_${i}`)
      .setLabel('Entfernen')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [navRow, actionRow], content: '' });
  resetTimeout(interaction.user.id, interaction);
}

// ── Button handler (called from index.js) ─────────────────────────────────────
async function handleButton(interaction) {
  // customId formats:
  //   rioshow_prev_{index}
  //   rioshow_next_{index}
  //   rioshow_activate_{charId}_{index}
  //   rioshow_deactivate_{charId}_{index}
  //   rioshow_delete_{charId}_{index}
  const [, action, ...rest] = interaction.customId.split('_');

  await interaction.deferUpdate();

  if (action === 'prev') {
    return showSheet(interaction, parseInt(rest[0], 10) - 1);
  }
  if (action === 'next') {
    return showSheet(interaction, parseInt(rest[0], 10) + 1);
  }

  const charId = parseInt(rest[0], 10);
  const index  = parseInt(rest[1], 10);
  const char   = await db.getCharacterById(charId);

  if (!char || char.discord_id !== interaction.user.id) {
    return interaction.editReply({ content: '❌ Charakter nicht gefunden.', embeds: [], components: [] });
  }

  if (action === 'activate') {
    await db.setActive(interaction.user.id, charId);
  } else if (action === 'deactivate') {
    await db.setInactive(interaction.user.id, charId);
  } else if (action === 'delete') {
    await db.removeCharacter(charId, interaction.user.id);
  }

  const activeChars = await db.getActiveCharacters(interaction.user.id);
  if (activeChars.length) {
    await applyRolesFromActive(interaction.member, activeChars);
  }

  const remaining = await db.getCharacters(interaction.user.id);
  const newIndex  = Math.min(index, Math.max(0, remaining.length - 1));
  await showSheet(interaction, newIndex);
}

module.exports = { execute, handleButton };
