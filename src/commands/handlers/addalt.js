const { EmbedBuilder }  = require('discord.js');
const db                = require('../../db');
const { fetchRioScore } = require('../../rioApi');
const { TIERS }         = require('../../roles');

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const name   = interaction.options.getString('name').trim().toLowerCase();
  const realm  = interaction.options.getString('realm').trim().replace(/\s+/g, '-').toLowerCase();
  const region = interaction.options.getString('region') ?? 'eu';

  const result = await fetchRioScore(name, realm, region);
  if (result.error) return interaction.editReply(`❌ ${result.error}`);

  const { score, spec, cls, thumbnail, profileUrl } = result;

  await db.upsertCharacter(interaction.user.id, name, realm, region);
  const chars = await db.getCharacters(interaction.user.id);
  const char  = chars.find(c => c.char_name === name && c.realm === realm && c.region === region);
  await db.updateScore(char.id, score, spec, cls);

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
    .setFooter({ text: 'Alle Chars anzeigen mit /rio show' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { execute };
