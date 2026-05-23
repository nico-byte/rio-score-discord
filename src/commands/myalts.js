const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db             = require('../db');
const { applyRoles } = require('../roles');

const definition = new SlashCommandBuilder()
  .setName('myalts')
  .setDescription('Zeigt alle deine verknüpften Charaktere');

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await showAlts(interaction);
}

async function showAlts(interaction) {
  const characters = await db.getCharacters(interaction.user.id);

  if (!characters.length) {
    return interaction.editReply('Du hast noch keine Charaktere verknüpft. Nutze `/rio` um deinen Hauptcharakter zu setzen.');
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Deine Charaktere')
    .setDescription(characters.map(c => {
      const active = c.is_active ? '✅ **Aktiv**' : '⬜ Inaktiv';
      const score  = c.rio_score ? `${c.rio_score.toLocaleString('de-DE')} IO` : 'Noch nicht geladen';
      return `${active} — **${c.char_name}** (${c.realm} / ${c.region.toUpperCase()}) — ${score}`;
    }).join('\n'))
    .setFooter({ text: 'Aktiver Charakter bestimmt deinen Nickname und deine Rollen' });

  // One row of buttons per character (max 5 per row, Discord limit)
  const rows = [];
  for (let i = 0; i < characters.length; i += 2) {
    const row = new ActionRowBuilder();
    const chunk = characters.slice(i, i + 2);

    for (const c of chunk) {
      if (!c.is_active) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`setactive_${c.id}`)
            .setLabel(`▶ ${c.char_name} aktivieren`)
            .setStyle(ButtonStyle.Primary),
        );
      }
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`remove_${c.id}`)
          .setLabel(`✕ ${c.char_name} entfernen`)
          .setStyle(ButtonStyle.Danger),
      );
    }

    if (row.components.length) rows.push(row);
  }

  await interaction.editReply({ embeds: [embed], components: rows.slice(0, 5) });
}

// Called from index.js when a button in /myalts is clicked
async function handleButton(interaction) {
  const [action, idStr] = interaction.customId.split('_');
  const charId = parseInt(idStr, 10);
  const char   = await db.getCharacterById(charId);

  if (!char || char.discord_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Charakter nicht gefunden.', ephemeral: true });
  }

  if (action === 'setactive') {
    await interaction.deferUpdate();
    await db.setActive(interaction.user.id, charId);

    // Update Discord roles + nickname to reflect new active char
    await applyRoles(interaction.member, char.rio_score, char.class, char.char_name);

    // Refresh the /myalts message
    await showAlts(interaction);

  } else if (action === 'remove') {
    await interaction.deferUpdate();
    const wasActive = char.is_active;
    await db.removeCharacter(charId, interaction.user.id);

    if (wasActive) {
      // Auto-activate the next available character
      const remaining = await db.getCharacters(interaction.user.id);
      if (remaining.length) {
        await db.setActive(interaction.user.id, remaining[0].id);
        await applyRoles(interaction.member, remaining[0].rio_score, remaining[0].class, remaining[0].char_name);
      }
    }

    await showAlts(interaction);
  }
}

module.exports = { definition, execute, handleButton };
