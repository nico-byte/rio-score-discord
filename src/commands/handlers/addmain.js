const { EmbedBuilder }          = require('discord.js');
const db                        = require('../../db');
const { fetchRioScore }         = require('../../rioApi');
const { applyRolesFromActive }  = require('../../roles');

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const inputName = interaction.options.getString('name').trim().toLowerCase();
  const realm     = interaction.options.getString('realm').trim().replace(/\s+/g, '-').toLowerCase();
  const region    = interaction.options.getString('region') ?? 'eu';

  const result = await fetchRioScore(inputName, realm, region);
  if (result.error) return interaction.editReply(`❌ ${result.error}`);

  const { name, realm: properRealm, score, spec, cls, thumbnail, profileUrl } = result;

  await db.upsertCharacter(interaction.user.id, name, properRealm, region);
  const chars = await db.getCharacters(interaction.user.id);
  const char  = chars.find(c => c.char_name.toLowerCase() === name.toLowerCase() && c.realm.toLowerCase() === properRealm.toLowerCase() && c.region === region);
  await db.updateScore(char.id, score, spec, cls);
  await db.setActive(interaction.user.id, char.id);

  const allUserChars = await db.getCharacters(interaction.user.id);
  const tier = await applyRolesFromActive(interaction.member, allUserChars);

  const embed = new EmbedBuilder()
    .setColor(tier.color)
    .setAuthor({ name: `${name} — ${properRealm} (${region.toUpperCase()})`, iconURL: thumbnail })
    .setTitle('Hauptcharakter gesetzt ✅')
    .setURL(profileUrl)
    .addFields(
      { name: 'M+ Score',        value: `**${score.toLocaleString('de-DE')} IO**`, inline: true },
      { name: 'Klasse',          value: cls,                                        inline: true },
      { name: 'Spezialisierung', value: spec,                                       inline: true },
      { name: 'Tier-Rolle',      value: tier.label,                                 inline: false },
    )
    .setFooter({ text: 'Twinks hinzufügen mit /rio addalt • Score wird täglich aktualisiert' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { execute };
