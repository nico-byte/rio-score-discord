require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const rioCommand  = require('./src/commands/rio');
const lfgCommand  = require('./src/commands/lfg');
const teamCommand = require('./src/commands/team');
const { startScheduler } = require('./src/scheduler');
const apply  = require('./src/commands/handlers/lfg/apply');
const manage = require('./src/commands/handlers/lfg/manage');
const invite = require('./src/commands/handlers/lfg/invite');
const channelGuard = require('./src/channelGuard');

// ─── Logging ────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString();
}

async function timed(type, label, user, fn) {
  const start = Date.now();
  try {
    await fn();
    console.log(`[${ts()}] [${type}] ${label} — ${user} — ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[${ts()}] [${type}] ${label} — ${user} — ${Date.now() - start}ms — ERROR:`, err);
    throw err;
  }
}

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
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once('clientReady', async () => {
  console.log(`✅ Bot online als ${client.user.tag}`);
  await registerCommands();
  startScheduler(client);
});

client.on('interactionCreate', async interaction => {
  const who = `${interaction.user.tag} (${interaction.user.id})`;

  // ── Slash commands ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const channelError = channelGuard.checkCommandChannel(interaction);
    if (channelError) {
      return interaction.reply({ content: channelError, ephemeral: true });
    }
    const command = COMMANDS[interaction.commandName];
    if (!command) return;
    const sub   = interaction.options.getSubcommand(false);
    const label = sub ? `/${interaction.commandName} ${sub}` : `/${interaction.commandName}`;
    await timed('CMD', label, who, () => command.execute(interaction));
    return;
  }

  // ── Select menus ────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    const id = interaction.customId;
    if (id.startsWith('lfgcreate_')) {
      await timed('SEL', id, who, () => lfgCommand.handleSelect(interaction));
    } else if (id === 'lfgapply_chars') {
      await timed('SEL', id, who, () => apply.handleApplySelect(interaction));
    }
    return;
  }

  // ── Buttons ─────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id.startsWith('rioshow_')) {
      await timed('BTN', id, who, () => rioCommand.handleButton(interaction));
    } else if (id === 'lfgcreate_next') {
      await timed('BTN', id, who, () => lfgCommand.showStep2(interaction));
    } else if (id === 'lfgcreate_confirm') {
      await timed('BTN', id, who, () => lfgCommand.handleConfirm(interaction));
    } else if (id === 'lfgcreate_cancel') {
      await timed('BTN', id, who, () => lfgCommand.handleCancel(interaction));
    } else if (id === 'lfgapply_confirm') {
      await timed('BTN', id, who, () => apply.handleApplyConfirm(interaction));
    } else if (id === 'lfgapply_cancel') {
      await timed('BTN', id, who, () => apply.handleApplyCancel(interaction));
    } else if (id.startsWith('lfgapply_')) {
      await timed('BTN', id, who, () => apply.handleApplyButton(interaction));
    } else if (id.startsWith('lfgapprove_')) {
      await timed('BTN', id, who, () => manage.handleApprove(interaction));
    } else if (id.startsWith('lfgreject_')) {
      await timed('BTN', id, who, () => manage.handleReject(interaction));
    } else if (id.startsWith('lfgstart_')) {
      await timed('BTN', id, who, () => manage.handleStart(interaction));
    } else if (id.startsWith('lfgclose_')) {
      await timed('BTN', id, who, () => manage.handleClose(interaction));
    } else if (id.startsWith('lfgaccept_')) {
      await timed('BTN', id, who, () => invite.handleAccept(interaction));
    } else if (id.startsWith('lfgdecline_')) {
      await timed('BTN', id, who, () => invite.handleDecline(interaction));
    }
  }
});

// ─── Channel guard (tool channels only allow their own commands) ─────────────
client.on('messageCreate', message => channelGuard.handleMessage(message));

// ─── Auto-delete empty LFG voice channels ───────────────────────────────────
client.on('voiceStateUpdate', async (oldState, newState) => {
  const leftChannel = oldState.channel;
  if (!leftChannel || leftChannel.id === newState.channelId) return;
  if (leftChannel.members.size > 0) return;

  const group = await db.getLfgGroupByVoiceChannel(leftChannel.id).catch(() => null);
  if (!group) return;
  if (group.status === 'open') return; // Keep VC alive while the key is still being filled

  console.log(`[${ts()}] [VC] Auto-deleting empty LFG voice channel ${leftChannel.id} (LFG ${group.id})`);
  await leftChannel.delete().catch(() => {});
  await db.setLfgVoiceChannel(group.id, null);
});

// ─── Error handling ─────────────────────────────────────────────────────────
client.on('error', err => console.error('Client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

const db = require('./src/db');
db.init().then(() => client.login(process.env.DISCORD_TOKEN));
