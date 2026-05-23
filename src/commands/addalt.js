const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db                = require('../db');
const { fetchRioScore } = require('../rioApi');
const { TIERS }         = require('../roles');

const definition = new SlashCommandBuilder()
  .setName('addalt')
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
      ));

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const name   = interaction.options.getString('name').trim().toLowerCase();
  const realm  = interaction.options.getString('realm').trim().replace(/\s+/g, '-').toLowerCase();
  const region = interaction.options.getString('region') ?? 'eu';

  const result = await fetchRioScore(name, realm, region);
  if (result.error) return interaction.editReply(`❌ ${result.error}`);

  const { score, spec, cls, thumbnail, profileUrl } = result;

  db.upsertCharacter(interaction.user.id, name, realm, region);
  const char = db.getCharacters(interaction.user.id).find(
    c => c.char_name === name && c.realm === realm && c.region === region
  );
  db.updateScore(char.id, score, spec, cls);

  const tier = TIERS.find(t => score >= t.min) ?? TIERS[TIERS.length - 1];

  const embed = new EmbedBuilder()
    .setColor(tier.color)
    .setAuthor({ name: `${name} — ${realm} (${region.toUpperCase()})`, iconURL: thumbnail })
    .setTitle('Twink hinzugefügt ✅')
    .setURL(profileUrl)
    .addFields(
      { name: 'M+ Score',        value: `**${score.toLocaleString('de-DE')} IO**`, inline: true },
      { name: 'Klasse',          value: cls,                                        inline: true },
      { name: 'Spezialisierung', value: spec,                                       inline: true },
    )
    .setFooter({ text: 'Alle Chars anzeigen mit /myalts' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { definition, execute };
