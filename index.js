require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const rioCommand  = require('./src/commands/rio');
const lfgCommand  = require('./src/commands/lfg');
const teamCommand = require('./src/commands/team');
const { startScheduler } = require('./src/scheduler');
const apply  = require('./src/commands/handlers/lfg/apply');
const manage = require('./src/commands/handlers/lfg/manage');
const invite = require('./src/commands/handlers/lfg/invite');

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
      try { await lfgCommand.handleSelect(interaction); }
      catch (err) { console.error('Select error (lfgcreate):', err); }
    } else if (interaction.customId === 'lfgapply_chars') {
      try { await apply.handleApplySelect(interaction); }
      catch (err) { console.error('Select error (lfgapply_chars):', err); }
    }
    return;
  }

  // ── Buttons ─────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;

    // /rio show pagination
    if (id.startsWith('rioshow_')) {
      try { await rioCommand.handleButton(interaction); }
      catch (err) { console.error('Button error (rioshow):', err); }

    // LFG create flow
    } else if (id === 'lfgcreate_next') {
      try { await lfgCommand.showStep2(interaction); }
      catch (err) { console.error('Button error (lfgcreate_next):', err); }
    } else if (id === 'lfgcreate_confirm') {
      try { await lfgCommand.handleConfirm(interaction); }
      catch (err) { console.error('Button error (lfgcreate_confirm):', err); }
    } else if (id === 'lfgcreate_cancel') {
      try { await lfgCommand.handleCancel(interaction); }
      catch (err) { console.error('Button error (lfgcreate_cancel):', err); }

    // LFG apply flow
    } else if (id === 'lfgapply_confirm') {
      try { await apply.handleApplyConfirm(interaction); }
      catch (err) { console.error('Button error (lfgapply_confirm):', err); }
    } else if (id === 'lfgapply_cancel') {
      try { await apply.handleApplyCancel(interaction); }
      catch (err) { console.error('Button error (lfgapply_cancel):', err); }
    } else if (id.startsWith('lfgapply_')) {
      // lfgapply_{lfgId} — the Apply button on announcements
      try { await apply.handleApplyButton(interaction); }
      catch (err) { console.error('Button error (lfgapply):', err); }

    // LFG manage (keyholder actions)
    } else if (id.startsWith('lfgapprove_')) {
      try { await manage.handleApprove(interaction); }
      catch (err) { console.error('Button error (lfgapprove):', err); }
    } else if (id.startsWith('lfgreject_')) {
      try { await manage.handleReject(interaction); }
      catch (err) { console.error('Button error (lfgreject):', err); }
    } else if (id.startsWith('lfgclose_')) {
      try { await manage.handleClose(interaction); }
      catch (err) { console.error('Button error (lfgclose):', err); }

    // LFG invite (applicant response)
    } else if (id.startsWith('lfgaccept_')) {
      try { await invite.handleAccept(interaction); }
      catch (err) { console.error('Button error (lfgaccept):', err); }
    } else if (id.startsWith('lfgdecline_')) {
      try { await invite.handleDecline(interaction); }
      catch (err) { console.error('Button error (lfgdecline):', err); }
    }
  }
});

// ─── Error handling ─────────────────────────────────────────────────────────
client.on('error', err => console.error('Client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

const db = require('./src/db');
db.init().then(() => client.login(process.env.DISCORD_TOKEN));
