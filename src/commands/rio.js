const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db                = require('../db');
const { fetchRioScore } = require('../rioApi');
const { applyRoles, TIERS } = require('../roles');

const definition = new SlashCommandBuilder()
  .setName('rio')
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
      ));

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const name   = interaction.options.getString('name').trim().toLowerCase();
  const realm  = interaction.options.getString('realm').trim().replace(/\s+/g, '-').toLowerCase();
  const region = interaction.options.getString('region') ?? 'eu';

  const result = await fetchRioScore(name, realm, region);
  if (result.error) return interaction.editReply(`❌ ${result.error}`);

  const { score, spec, cls, thumbnail, profileUrl } = result;
 
  // Save to DB and mark as active
  await db.upsertCharacter(interaction.user.id, name, realm, region);
  const chars = await db.getCharacters(interaction.user.id);
  const char  = chars.find(
    c => c.char_name === name && c.realm === realm && c.region === region
  );
  await db.updateScore(char.id, score, spec, cls);
  await db.setActive(interaction.user.id, char.id);

  // Apply Discord roles + nickname
  const tier = await applyRoles(interaction.member, score, cls, name);

  const embed = new EmbedBuilder()
    .setColor(tier.color)
    .setAuthor({ name: `${name} — ${realm} (${region.toUpperCase()})`, iconURL: thumbnail })
    .setTitle('Hauptcharakter gesetzt ✅')
    .setURL(profileUrl)
    .addFields(
      { name: 'M+ Score',        value: `**${score.toLocaleString('de-DE')} IO**`, inline: true },
      { name: 'Klasse',          value: cls,                                        inline: true },
      { name: 'Spezialisierung', value: spec,                                       inline: true },
      { name: 'Tier-Rolle',      value: tier.label,                                 inline: false },
    )
    .setFooter({ text: 'Twinks hinzufügen mit /addalt • Score wird täglich aktualisiert' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { definition, execute };
