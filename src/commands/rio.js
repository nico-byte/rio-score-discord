const { SlashCommandBuilder } = require('discord.js');
const addmain = require('./handlers/addmain');
const addalt  = require('./handlers/addalt');
const show    = require('./handlers/show');

const definition = new SlashCommandBuilder()
  .setName('rio')
  .setDescription('WoW Charakter-Verwaltung')
  .addSubcommand(sub =>
    sub.setName('addmain')
      .setDescription('Setzt deinen Hauptcharakter und zeigt deinen Raider.IO Score')
      .addStringOption(opt =>
        opt.setName('name').setDescription('Charaktername').setRequired(true))
      .addStringOption(opt =>
        opt.setName('realm').setDescription('Realm (z.B. blackrock)').setRequired(true))
      .addStringOption(opt =>
        opt.setName('region').setDescription('Region').setRequired(false)
          .addChoices(
            { name: 'EU', value: 'eu' },
            { name: 'US', value: 'us' },
            { name: 'TW', value: 'tw' },
            { name: 'KR', value: 'kr' },
          )))
  .addSubcommand(sub =>
    sub.setName('addalt')
      .setDescription('Fügt einen Twink zu deinem Profil hinzu')
      .addStringOption(opt =>
        opt.setName('name').setDescription('Charaktername').setRequired(true))
      .addStringOption(opt =>
        opt.setName('realm').setDescription('Realm (z.B. blackrock)').setRequired(true))
      .addStringOption(opt =>
        opt.setName('region').setDescription('Region').setRequired(false)
          .addChoices(
            { name: 'EU', value: 'eu' },
            { name: 'US', value: 'us' },
            { name: 'TW', value: 'tw' },
            { name: 'KR', value: 'kr' },
          )))
  .addSubcommand(sub =>
    sub.setName('show')
      .setDescription('Zeigt alle deine verknüpften Charaktere'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'addmain') return addmain.execute(interaction);
  if (sub === 'addalt')  return addalt.execute(interaction);
  if (sub === 'show')    return show.execute(interaction);
}

module.exports = { definition, execute, handleButton: show.handleButton };
