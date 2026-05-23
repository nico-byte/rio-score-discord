const TIERS = [
  { min: 4000, roleId: process.env.ROLE_HARDCORE_PUSHER, label: '🟣 Hardcore Pusher 4k+', color: 0x8e44ad },
  { min: 3500, roleId: process.env.ROLE_EXTREME_PUSHER,  label: '🟤 Extreme Pusher 3k5+', color: 0xd35400 },
  { min: 3000, roleId: process.env.ROLE_PUSHER,          label: '🟠 Pusher 3k+',           color: 0xe67e22 },
  { min: 2500, roleId: process.env.ROLE_WEEKLY,          label: '🟡 Weekly 2k5+',          color: 0xf1c40f },
  { min: 1500, roleId: process.env.ROLE_EBNNJOYER,       label: '⚫ Enjoyer 1k5+',         color: 0x7f8c8d },
  { min: 0,    roleId: process.env.ROLE_ROOKIE,          label: '⚪ Rookie <1k5',          color: 0x95a5a6 },
];

const CLASS_ROLES = {
  'Warrior':      process.env.ROLE_CLASS_WARRIOR,
  'Paladin':      process.env.ROLE_CLASS_PALADIN,
  'Hunter':       process.env.ROLE_CLASS_HUNTER,
  'Rogue':        process.env.ROLE_CLASS_ROGUE,
  'Priest':       process.env.ROLE_CLASS_PRIEST,
  'Death Knight': process.env.ROLE_CLASS_DK,
  'Shaman':       process.env.ROLE_CLASS_SHAMAN,
  'Mage':         process.env.ROLE_CLASS_MAGE,
  'Warlock':      process.env.ROLE_CLASS_WARLOCK,
  'Monk':         process.env.ROLE_CLASS_MONK,
  'Druid':        process.env.ROLE_CLASS_DRUID,
  'Demon Hunter': process.env.ROLE_CLASS_DH,
  'Evoker':       process.env.ROLE_CLASS_EVOKER,
};

/**
 * Updates tier role, class role and nickname for a guild member.
 * Safe to call from both commands and the daily scheduler.
 * Returns the matched tier (for embed coloring).
 */
async function applyRoles(member, score, cls, charName) {
  await updateTierRole(member, score);
  await updateClassRole(member, cls);
  await updateNickname(member, charName, score);
  return TIERS.find(t => score >= t.min) ?? TIERS[TIERS.length - 1];
}

async function updateTierRole(member, score) {
  const allIds    = TIERS.map(t => t.roleId).filter(Boolean);
  const correct   = TIERS.find(t => score >= t.min);
  if (!correct?.roleId) return;

  await Promise.all(allIds.map(id => member.roles.remove(id).catch(() => {})));
  await member.roles.add(correct.roleId).catch(() => {});
}

async function updateClassRole(member, cls) {
  const allIds  = Object.values(CLASS_ROLES).filter(Boolean);
  const correct = CLASS_ROLES[cls];

  await Promise.all(allIds.map(id => member.roles.remove(id).catch(() => {})));
  if (correct) await member.roles.add(correct).catch(() => {});
}

async function updateNickname(member, charName, score) {
  const nick = `${charName} | ${score.toLocaleString('de-DE')} IO`;
  await member.setNickname(nick.slice(0, 32)).catch(() => {});
}

module.exports = { applyRoles, TIERS };
