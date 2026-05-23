require('dotenv').config();
const fetch = require('node-fetch');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');

// ─── Tier role config ───────────────────────────────────────────────────────
// Each tier: minimum score, role ID from your .env, display label, embed color
const TIERS = [
  { min: 4000, roleId: process.env.ROLE_HARDCORE_PUSHER, label: '🟣 Hardcore Pusher 4k+',      color: 0x8e44ad }, // Magenta/Purple
  { min: 3500, roleId: process.env.ROLE_EXTREME_PUSHER,  label: '🟤 Extreme Pusher 3k5+',      color: 0xd35400 }, // Dark Orange
  { min: 3000, roleId: process.env.ROLE_PUSHER,          label: '🟠 Pusher 3k+',               color: 0xe67e22 }, // Orange
  { min: 2500, roleId: process.env.ROLE_WEEKLY,          label: '🟡 Weekly 2k5+',              color: 0xf1c40f }, // Dark Yellow/Gold
  { min: 1500, roleId: process.env.ROLE_EBNNJOYER,       label: '⚫ Enjoyer 1k5+',             color: 0x7f8c8d }, // Grey
  { min: 0,    roleId: process.env.ROLE_ROOKIE,          label: '⚪ Rookie <1k5',              color: 0xffffff }, // White
];

// ─── Slash command definition ───────────────────────────────────────────────
const RIO_COMMAND = new SlashCommandBuilder()
  .setName('rio')
  .setDescription('Verknüpfe deinen WoW-Charakter und zeige deinen Raider.IO Score')
  .addStringOption(opt =>
    opt.setName('name')
      .setDescription('Charaktername (z.B. Thaldron)')
      .setRequired(true))
  .addStringOption(opt =>
    opt.setName('realm')
      .setDescription('Realm (z.B. blackrock, die-todesminen)')
      .setRequired(true))
  .addStringOption(opt =>
    opt.setName('region')
      .setDescription('Region (eu / us / tw / kr)')
      .setRequired(false)
      .addChoices(
        { name: 'EU', value: 'eu' },
        { name: 'US', value: 'us' },
        { name: 'TW', value: 'tw' },
        { name: 'KR', value: 'kr' },
      ));

// ─── Register slash command with Discord ────────────────────────────────────
async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [RIO_COMMAND.toJSON()] },
    );
    console.log('✅ Slash command /rio registered');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// ─── Fetch score from Raider.IO public API ──────────────────────────────────
async function fetchRioScore(name, realm, region) {
  // Raider.IO public API — no API key needed
  const url = `https://raider.io/api/v1/characters/profile`
    + `?region=${region}`
    + `&realm=${encodeURIComponent(realm)}`
    + `&name=${encodeURIComponent(name)}`
    + `&fields=mythic_plus_scores_by_season:current,mythic_plus_best_runs,class,active_spec_name`;

  const res = await fetch(url);

  if (res.status === 404) return { error: 'Charakter nicht gefunden. Prüfe Name, Realm und Region.' };
  if (!res.ok)           return { error: `Raider.IO API Fehler (${res.status}). Bitte später nochmal versuchen.` };

  const data = await res.json();

  const score = Math.round(
    data?.mythic_plus_scores_by_season?.[0]?.scores?.all ?? 0
  );

  return {
    score,
    spec:      data.active_spec_name ?? 'Unbekannt',
    cls:       data.class            ?? 'Unbekannt',
    thumbnail: data.thumbnail_url,
    profileUrl: `https://raider.io/characters/${region}/${realm}/${name}`,
  };
}

// ─── Assign the right tier role, remove old ones ───────────────────────────
async function updateTierRole(member, score) {
  const allTierRoleIds = TIERS.map(t => t.roleId).filter(Boolean);

  // Find the correct tier
  const correctTier = TIERS.find(t => score >= t.min);
  if (!correctTier?.roleId) return null;

  // Remove all tier roles first, then add the correct one
  for (const roleId of allTierRoleIds) {
    if (member.roles.cache.has(roleId) && roleId !== correctTier.roleId) {
      await member.roles.remove(roleId).catch(() => {});
    }
  }
  await member.roles.add(correctTier.roleId).catch(() => {});

  return correctTier;
}

// ─── Update nickname to "CharName | 1234 IO" ───────────────────────────────
async function updateNickname(member, charName, score) {
  const nick = `${charName} | ${score.toLocaleString('de-DE')} IO`;
  // Nickname max length is 32 — truncate char name if needed
  await member.setNickname(nick.slice(0, 32)).catch(() => {
    // Bot can't change owner's nickname — silently ignore
  });
}

// ─── Build the response embed ───────────────────────────────────────────────
function buildEmbed(charName, realm, region, score, spec, cls, thumbnail, profileUrl, tier) {
  return new EmbedBuilder()
    .setColor(tier.color)
    .setAuthor({ name: `${charName} — ${realm} (${region.toUpperCase()})`, iconURL: thumbnail })
    .setTitle('Raider.IO Profil verknüpft ✅')
    .setURL(profileUrl)
    .addFields(
      { name: 'M+ Score',  value: `**${score.toLocaleString('de-DE')} IO**`, inline: true },
      { name: 'Klasse',    value: cls,                                         inline: true },
      { name: 'Spezialisierung', value: spec,                                  inline: true },
      { name: 'Tier-Rolle', value: tier.label,                                 inline: false },
    )
    .setFooter({ text: 'Score wird beim nächsten /rio Aufruf aktualisiert • raider.io' })
    .setTimestamp();
}

// ─── Discord client ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('ready', async () => {
  console.log(`✅ Bot online als ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'rio') return;

  await interaction.deferReply({ ephemeral: false });

  const name   = interaction.options.getString('name').trim();
  const realm  = interaction.options.getString('realm').trim().replace(/\s+/g, '-');
  const region = interaction.options.getString('region') ?? 'eu';

  // Fetch from Raider.IO
  const result = await fetchRioScore(name, realm, region);

  if (result.error) {
    return interaction.editReply({ content: `❌ ${result.error}` });
  }

  const { score, spec, cls, thumbnail, profileUrl } = result;
  const member = interaction.member;

  // Update role + nickname
  const tier = await updateTierRole(member, score);
  await updateNickname(member, name, score);

  const embed = buildEmbed(
    name, realm, region, score, spec, cls, thumbnail, profileUrl,
    tier ?? TIERS[TIERS.length - 1],
  );

  await interaction.editReply({ embeds: [embed] });
});

// ─── Start ──────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
