const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const db                        = require('../db');
const { applyRolesFromActive }  = require('../roles');

const definition = new SlashCommandBuilder()
  .setName('myalts')
  .setDescription('Zeigt alle deine verknüpften Charaktere');

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await showOverview(interaction);
}

// ── Main overview ───────────────────────────────────────────────────────────
async function showOverview(interaction) {
  const characters = await db.getCharacters(interaction.user.id);

  if (!characters.length) {
    return interaction.editReply({
      content: 'Du hast noch keine Charaktere verknüpft. Nutze `/rio` um deinen Hauptcharakter zu setzen.',
      components: [],
    });
  }

  const lines = characters.map(c => {
    const status = c.is_active ? '✅' : '⬜';
    const score  = c.rio_score ? `${Number(c.rio_score).toLocaleString('de-DE')} IO` : '—';
    const cls    = c.class ?? '?';
    return `${status} **${c.char_name}** — ${cls} — ${score} *(${c.realm} / ${c.region.toUpperCase()})*`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Deine Charaktere')
    .setDescription(lines.join('\n'))
    .setFooter({ text: '✅ Aktiv  •  ⬜ Inaktiv  •  Aktive Chars bestimmen Rollen & Nickname' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('myalts_btn_activate')
      .setLabel('Aktivieren')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('myalts_btn_deactivate')
      .setLabel('Deaktivieren')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('myalts_btn_delete')
      .setLabel('Entfernen')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ── Button handler (called from index.js) ───────────────────────────────────
async function handleButton(interaction) {
  const action = interaction.customId; // myalts_btn_activate / _deactivate / _delete
  const characters = await db.getCharacters(interaction.user.id);

  if (!characters.length) {
    return interaction.reply({ content: 'Keine Charaktere gefunden.', ephemeral: true });
  }

  let eligible;
  let placeholder;

  if (action === 'myalts_btn_activate') {
    eligible    = characters.filter(c => !c.is_active);
    placeholder = 'Welchen Charakter aktivieren?';
  } else if (action === 'myalts_btn_deactivate') {
    eligible    = characters.filter(c => c.is_active);
    placeholder = 'Welchen Charakter deaktivieren?';
  } else {
    eligible    = characters;
    placeholder = 'Welchen Charakter entfernen?';
  }

  if (!eligible.length) {
    await interaction.reply({
      content: action === 'myalts_btn_activate'
        ? '✅ Alle Charaktere sind bereits aktiv.'
        : action === 'myalts_btn_deactivate'
        ? '⬜ Keine aktiven Charaktere zum Deaktivieren.'
        : '❌ Keine Charaktere vorhanden.',
      ephemeral: true,
    });
    return;
  }

  const selectId = action === 'myalts_btn_activate'   ? 'myalts_sel_activate'
                 : action === 'myalts_btn_deactivate' ? 'myalts_sel_deactivate'
                 :                                      'myalts_sel_delete';

  const menu = new StringSelectMenuBuilder()
    .setCustomId(selectId)
    .setPlaceholder(placeholder)
    .addOptions(eligible.map(c => ({
      label: `${c.char_name} (${c.realm})`,
      description: `${c.class ?? '?'} — ${c.rio_score ? Number(c.rio_score).toLocaleString('de-DE') + ' IO' : 'Kein Score'}`,
      value: String(c.id),
    })));

  const row = new ActionRowBuilder().addComponents(menu);
  await interaction.reply({ components: [row], ephemeral: true });
}

// ── Select menu handler (called from index.js) ───────────────────────────────
async function handleSelect(interaction) {
  const charId = parseInt(interaction.values[0], 10);
  const char   = await db.getCharacterById(charId);

  if (!char || char.discord_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Charakter nicht gefunden.', ephemeral: true });
  }

  await interaction.deferUpdate();

  if (interaction.customId === 'myalts_sel_activate') {
    await db.setActive(interaction.user.id, charId);
  } else if (interaction.customId === 'myalts_sel_deactivate') {
    await db.setInactive(interaction.user.id, charId);
  } else {
    await db.removeCharacter(charId, interaction.user.id);
  }

  // Recompute roles based on new active set
  const activeChars = await db.getActiveCharacters(interaction.user.id);
  if (activeChars.length) {
    await applyRolesFromActive(interaction.member, activeChars);
  }

  // Refresh the overview message
  await showOverview(interaction);
}

module.exports = { definition, execute, handleButton, handleSelect };