require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const rioCommand    = require('./src/commands/rio');
const addaltCommand = require('./src/commands/addalt');
const myaltsCommand = require('./src/commands/myalts');
const { startScheduler } = require('./src/scheduler');
const { startLfgForwarder } = require('./src/lfgForwarder');

// ─── Command registry ───────────────────────────────────────────────────────
const COMMANDS = {
  rio:    rioCommand,
  addalt: addaltCommand,
  myalts: myaltsCommand,
};

// ─── Register slash commands with Discord ───────────────────────────────────
async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: Object.values(COMMANDS).map(c => c.definition.toJSON()) },
    );
    console.log('✅ Slash commands registered (/rio, /addalt, /myalts)');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// ─── Discord client ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

client.once('clientReady', async () => {
  console.log(`✅ Bot online als ${client.user.tag}`);
  await registerCommands();
  startScheduler(client);
  startLfgForwarder(client);
});

client.on('interactionCreate', async interaction => {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    const command = COMMANDS[interaction.commandName];
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Command error (/${interaction.commandName}):`, err);
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('myalts_')) {
    try {
      await myaltsCommand.handleButton(interaction);
    } catch (err) {
      console.error('Button error:', err);
    }
  }
});

// ─── Error handling ─────────────────────────────────────────────────────────
client.on('error', err => console.error('Client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

const db = require('./src/db');
db.init().then(() => client.login(process.env.DISCORD_TOKEN));
