const db              = require('./db');
const { fetchRioScore } = require('./rioApi');
const { applyRoles }  = require('./roles');

/**
 * Starts the daily refresh scheduler.
 * First run: at the next 4:00 AM server time.
 * Then: every 24 hours.
 */
function startScheduler(client) {
  const msUntil4am = getMsUntilNextHour(4);
  console.log(`⏰ Daily refresh scheduled in ${Math.round(msUntil4am / 1000 / 60)} minutes (next 4:00 AM)`);

  setTimeout(async () => {
    await runDailyRefresh(client);
    // After first run, repeat every 24h exactly
    setInterval(() => runDailyRefresh(client), 24 * 60 * 60 * 1000);
  }, msUntil4am);
}

async function runDailyRefresh(client) {
  console.log('🔄 Starting daily Rio refresh...');

  const characters = db.getStaleCharacters();
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

    db.updateScore(char.id, result.score, result.spec, result.cls);
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
