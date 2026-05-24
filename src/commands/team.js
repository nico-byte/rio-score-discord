const { SlashCommandBuilder } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('team')
  .setDescription('Team-Verwaltung');

async function execute(interaction) {
  await interaction.reply({ content: 'Team-Befehle folgen bald.', ephemeral: true });
}

module.exports = { definition, execute };
