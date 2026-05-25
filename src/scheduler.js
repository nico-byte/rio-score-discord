const db              = require('./db');
const { fetchRioScore } = require('./rioApi');
const { applyRoles }  = require('./roles');

/**
 * Starts the daily refresh scheduler.
 * First run: at the next 4:00 AM server time.
 * Then: every 24 hours.
 */
const LFG_TIMEOUT_MS          = (parseInt(process.env.LFG_TIMEOUT_HOURS, 10) || 2) * 60 * 60 * 1000;
const ANNOUNCEMENT_LIFETIME_MS = 60 * 60 * 1000; // matches the 1h setTimeout in create.js

function startScheduler(client) {
  const msUntil4am = getMsUntilNextHour(4);
  console.log(`⏰ Daily refresh scheduled in ${Math.round(msUntil4am / 1000 / 60)} minutes (next 4:00 AM)`);

  setTimeout(async () => {
    await runDailyRefresh(client);
    setInterval(() => runDailyRefresh(client), 24 * 60 * 60 * 1000);
  }, msUntil4am);

  // Announcement sweep every 5 minutes (catches deletions lost on restart)
  setInterval(() => runAnnouncementSweep(client), 5 * 60 * 1000);

  // Stale LFG group cleanup every 30 minutes
  setInterval(() => runLfgCleanup(client), 30 * 60 * 1000);
}

async function runDailyRefresh(client) {
  console.log('🔄 Starting daily Rio refresh...');

  const characters = await db.getStaleCharacters();
  console.log(`   Found ${characters.length} characters to refresh`);

  let updated = 0;
  let failed  = 0;

  for (const char of characters) {
    const result = await fetchRioScore(char.char_name, char.realm, char.region);

    if (result.error) {
      console.warn(`   ⚠ ${char.char_name}-${char.realm}: ${result.error}`);
      failed++;
      continue;
    }

    await db.updateScore(char.id, result.score, result.spec, result.cls);
    updated++;

    // Only update Discord roles/nickname if this is the user's active character
    if (char.is_active) {
      try {
        const guild  = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(char.discord_id).catch(() => null);
        if (member) {
          await applyRoles(member, result.score, result.cls, char.char_name);
        }
      } catch (err) {
        console.warn(`   ⚠ Could not update Discord for ${char.discord_id}: ${err.message}`);
      }
    }

    // Small delay between API calls to avoid rate limiting
    await sleep(500);
  }

  console.log(`✅ Daily refresh done — ${updated} updated, ${failed} failed`);
}

async function runAnnouncementSweep(client) {
  const expired = await db.getExpiredAnnouncements(ANNOUNCEMENT_LIFETIME_MS);
  if (!expired.length) return;

  console.log(`🧹 Announcement sweep: deleting ${expired.length} expired announcement(s)`);
  await Promise.all(expired.map(async ann => {
    try {
      const guild = await client.guilds.fetch(ann.guild_id).catch(() => null);
      if (guild) {
        const ch  = guild.channels.cache.get(ann.channel_id) ?? await guild.channels.fetch(ann.channel_id).catch(() => null);
        const msg = ch ? await ch.messages.fetch(ann.message_id).catch(() => null) : null;
        if (msg) await msg.delete().catch(() => {});
      }
    } catch { /* already gone */ }
    await db.deleteLfgAnnouncement(ann.id);
  }));
}

async function runLfgCleanup(client) {
  const stale = await db.getStaleOpenLfgGroups(LFG_TIMEOUT_MS);
  if (!stale.length) return;

  console.log(`🧹 LFG cleanup: closing ${stale.length} stale group(s)`);

  for (const group of stale) {
    await db.closeLfgGroup(group.id);

    let guild;
    try { guild = await client.guilds.fetch(group.guild_id); } catch { continue; }

    // Delete announcement messages
    const announcements = await db.getLfgAnnouncements(group.id);
    for (const ann of announcements) {
      try {
        const ch  = guild.channels.cache.get(ann.channel_id) ?? await guild.channels.fetch(ann.channel_id).catch(() => null);
        const msg = ch ? await ch.messages.fetch(ann.message_id).catch(() => null) : null;
        if (msg) await msg.delete();
      } catch { /* already gone */ }
    }
    await db.deleteLfgAnnouncements(group.id);

    // Cancel pending/approved applications
    const apps = await db.getLfgApplications(group.id);
    const inviteChannel = guild.channels.cache.get(process.env.CHANNEL_PENDING_INVITES);
    for (const app of apps) {
      if (!['pending', 'approved'].includes(app.status)) continue;
      await db.setApplicationStatus(app.id, 'cancelled');
      if (app.invite_message_id && inviteChannel) {
        try {
          const msg = await inviteChannel.messages.fetch(app.invite_message_id);
          await msg.edit({ content: `<@${app.applicant_id}> Die LFG ist abgelaufen und wurde automatisch geschlossen.`, components: [] });
        } catch { /* already gone */ }
      }
    }

    // Delete voice channel
    if (group.voice_channel_id) {
      const vc = guild.channels.cache.get(group.voice_channel_id) ?? await guild.channels.fetch(group.voice_channel_id).catch(() => null);
      if (vc) await vc.delete().catch(() => {});
    }

    // Delete mgmt channel
    if (group.mgmt_channel_id) {
      const mc = guild.channels.cache.get(group.mgmt_channel_id) ?? await guild.channels.fetch(group.mgmt_channel_id).catch(() => null);
      if (mc) await mc.delete().catch(() => {});
    }

    console.log(`   Closed stale LFG ${group.id} (${group.dungeon} +${group.key_level})`);
  }
}

function getMsUntilNextHour(hour) {
  const now  = new Date();
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler };
