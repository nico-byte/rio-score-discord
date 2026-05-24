const { SlashCommandBuilder } = require('discord.js');
const create = require('./handlers/lfg/create');
const apply  = require('./handlers/lfg/apply');

const definition = new SlashCommandBuilder()
  .setName('lfg')
  .setDescription('Looking for group')
  .addSubcommand(sub =>
    sub.setName('create')
      .setDescription('Erstellt eine neue LFG-Gruppe und sucht Mitspieler'))
  .addSubcommand(sub =>
    sub.setName('apply')
      .setDescription('Bewirb dich für eine offene LFG-Gruppe'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'create') return create.openModal(interaction);
  if (sub === 'apply')  return apply.execute(interaction);
}

module.exports = {
  definition,
  execute,
  handleModal:   create.handleModal,
  handleSelect:  create.handleSelect,
  handleConfirm: create.handleConfirm,
  handleCancel:  create.handleCancel,
};
