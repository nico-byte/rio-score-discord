const { PermissionFlagsBits } = require('discord.js');

// ── Configurable thresholds (set in .env) ────────────────────────────────────
const STRIKE_WINDOW_MS    = (parseInt(process.env.CHANNEL_GUARD_WINDOW_MINUTES,  10) || 5) * 60_000;
const MAX_STRIKES         =  parseInt(process.env.CHANNEL_GUARD_MAX_STRIKES,     10) || 3;
const TIMEOUT_DURATION_MS = (parseInt(process.env.CHANNEL_GUARD_TIMEOUT_MINUTES, 10) || 5) * 60_000;

// ── Channel → allowed command mapping (built once at startup) ────────────────
const RULES = new Map();
if (process.env.CHANNEL_RIO_TOOL)  RULES.set(process.env.CHANNEL_RIO_TOOL,  { label: '#rio-tool',  command: '/rio'  });
if (process.env.CHANNEL_LFG_TOOL)  RULES.set(process.env.CHANNEL_LFG_TOOL,  { label: '#lfg-tool',  command: '/lfg'  });
if (process.env.CHANNEL_TEAM_TOOL) RULES.set(process.env.CHANNEL_TEAM_TOOL, { label: '#team-tool', command: '/team' });

// ── Strike tracker: userId → { strikes, windowStart } ────────────────────────
const violations = new Map();

function getRecord(userId) {
  const now = Date.now();
  let rec = violations.get(userId);
  if (!rec || now - rec.windowStart > STRIKE_WINDOW_MS) {
    rec = { strikes: 0, windowStart: now };
    violations.set(userId, rec);
  }
  return rec;
}

// Sends a message then auto-deletes it after `delayMs`
async function tempSend(channel, content, delayMs = 9_000) {
  const msg = await channel.send(content).catch(() => null);
  if (msg) setTimeout(() => msg.delete().catch(() => {}), delayMs);
}

// ── Called from messageCreate ─────────────────────────────────────────────────
async function handleMessage(message) {
  if (message.author.bot) return;

  const rule = RULES.get(message.channelId);
  if (!rule) return;

  // Moderators (ManageMessages or Administrator) are exempt
  if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  await message.delete().catch(() => {});

  const userId = message.author.id;
  const rec    = getRecord(userId);
  rec.strikes++;

  if (rec.strikes >= MAX_STRIKES) {
    violations.delete(userId);
    await message.member?.timeout(TIMEOUT_DURATION_MS, 'Wiederholte Regelverstöße im Bot-Channel').catch(() => {});

    await tempSend(
      message.channel,
      `⏱️ <@${userId}> wurde für **${Math.round(TIMEOUT_DURATION_MS / 60_000)} Minuten** stummgeschaltet.\n`
      + `Bitte ausschließlich **${rule.command}** in ${rule.label} verwenden.`,
      15_000,
    );
  } else {
    const remaining = MAX_STRIKES - rec.strikes;
    await tempSend(
      message.channel,
      `👋 Hey <@${userId}>! In diesem Channel bitte nur **${rule.command}** verwenden. `
      + `*(${remaining} Verwarnung${remaining === 1 ? '' : 'en'} bis zum Timeout)*`,
    );
  }
}

// ── Called before executing a slash command ───────────────────────────────────
// Returns an error string if the command is not allowed here, null otherwise.
function checkCommandChannel(interaction) {
  const rule = RULES.get(interaction.channelId);
  if (!rule) return null;

  if (`/${interaction.commandName}` === rule.command) return null;

  return `❌ In diesem Channel bitte nur **${rule.command}** verwenden.`;
}

module.exports = { handleMessage, checkCommandChannel };
