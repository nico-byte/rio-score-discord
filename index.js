require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const rioCommand  = require('./src/commands/rio');
const lfgCommand  = require('./src/commands/lfg');
const teamCommand = require('./src/commands/team');
const { startScheduler } = require('./src/scheduler');

// ─── Command registry ───────────────────────────────────────────────────────
const COMMANDS = {
  rio:  rioCommand,
  lfg:  lfgCommand,
  team: teamCommand,
};

// ─── Register slash commands with Discord ───────────────────────────────────
async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: Object.values(COMMANDS).map(c => c.definition.toJSON()) },
    );
    console.log('✅ Slash commands registered (/rio, /lfg, /team)');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// ─── Discord client ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('clientReady', async () => {
  console.log(`✅ Bot online als ${client.user.tag}`);
  await registerCommands();
  startScheduler(client);
});

client.on('interactionCreate', async interaction => {
  // ── Slash commands ──────────────────────────────────────────────────────
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

  // ── Select menus ────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('lfgcreate_')) {
      try {
        await lfgCommand.handleSelect(interaction);
      } catch (err) {
        console.error('Select error (lfgcreate):', err);
      }
    }
    return;
  }

  // ── Buttons ─────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('rioshow_')) {
      try {
        await rioCommand.handleButton(interaction);
      } catch (err) {
        console.error('Button error (rioshow):', err);
      }
    } else if (interaction.customId === 'lfgcreate_next') {
      try {
        await lfgCommand.showStep2(interaction);
      } catch (err) {
        console.error('Button error (lfgcreate_next):', err);
      }
    } else if (interaction.customId === 'lfgcreate_confirm') {
      try {
        await lfgCommand.handleConfirm(interaction);
      } catch (err) {
        console.error('Button error (lfgcreate_confirm):', err);
      }
    } else if (interaction.customId === 'lfgcreate_cancel') {
      try {
        await lfgCommand.handleCancel(interaction);
      } catch (err) {
        console.error('Button error (lfgcreate_cancel):', err);
      }
    }
  }
});

// ─── Error handling ─────────────────────────────────────────────────────────
client.on('error', err => console.error('Client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

const db = require('./src/db');
db.init().then(() => client.login(process.env.DISCORD_TOKEN));
