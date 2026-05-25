const TIERS = [
  { min: 4000, roleId: process.env.ROLE_HARDCORE_PUSHER, label: '🟣 Hardcore Pusher 4k+', color: 0x8e44ad },
  { min: 3500, roleId: process.env.ROLE_EXTREME_PUSHER,  label: '🟤 Extreme Pusher 3k5+', color: 0xd35400 },
  { min: 3000, roleId: process.env.ROLE_PUSHER,          label: '🟠 Pusher 3k+',           color: 0xe67e22 },
  { min: 2500, roleId: process.env.ROLE_WEEKLY,          label: '🟡 Weekly 2k5+',          color: 0xf1c40f },
  { min: 1500, roleId: process.env.ROLE_ENJOYER,         label: '⚫ Enjoyer 1k5+',         color: 0x7f8c8d },
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
 * Called after any activation/deactivation change.
 * Recalculates tier role (highest score among active chars) and
 * class roles (one per unique class among active chars).
 * activeChars = array of character rows that are currently active.
 */
async function applyRolesFromActive(member, activeChars) {
  const highestScore = activeChars.reduce((max, c) => Math.max(max, c.rio_score ?? 0), 0);
  const activeClasses = [...new Set(activeChars.map(c => c.class).filter(Boolean))];

  await updateTierRole(member, highestScore);
  await updateClassRoles(member, activeClasses);

  // Update nickname to highest-score active char
  // const top = activeChars.sort((a, b) => (b.rio_score ?? 0) - (a.rio_score ?? 0))[0];
  // if (top) await updateNickname(member, top.char_name, top.rio_score ?? 0);

  return TIERS.find(t => highestScore >= t.min) ?? TIERS[TIERS.length - 1];
}

/**
 * Convenience wrapper used by /rio and the scheduler
 * when only one character is relevant.
 */
async function applyRoles(member, score, cls, charName) {
  await updateTierRole(member, score);
  await updateClassRoles(member, [cls]);
  // await updateNickname(member, charName, score);
  return TIERS.find(t => score >= t.min) ?? TIERS[TIERS.length - 1];
}

async function updateClassRoles(member, classes) {
  const allIds     = Object.values(CLASS_ROLES).filter(Boolean);
  const correctIds = classes.map(c => CLASS_ROLES[c]).filter(Boolean);

  // 1. Find roles they HAVE that they SHOULD NOT have anymore
  const rolesToRemove = allIds.filter(id => 
    member.roles.cache.has(id) && !correctIds.includes(id)
  );

  // 2. Find roles they DO NOT HAVE that they SHOULD have
  const rolesToAdd = correctIds.filter(id => 
    !member.roles.cache.has(id)
  );

  // Apply only the necessary changes
  for (const id of rolesToRemove) await member.roles.remove(id).catch(() => {});
  for (const id of rolesToAdd) await member.roles.add(id).catch(() => {});
}

async function updateTierRole(member, score) {
  const allIds  = TIERS.map(t => t.roleId).filter(Boolean);
  const correct = TIERS.find(t => score >= t.min);
  if (!correct?.roleId) return;

  // 1. Find any old tier roles they have that aren't the correct one
  const rolesToRemove = allIds.filter(id => 
    member.roles.cache.has(id) && id !== correct.roleId
  );
  
  for (const id of rolesToRemove) await member.roles.remove(id).catch(() => {});
  
  // 2. Add the correct role only if they don't already have it
  if (!member.roles.cache.has(correct.roleId)) {
    await member.roles.add(correct.roleId).catch(() => {});
  }
}

async function updateNickname(member, charName, score) {
  const nick = `${charName} | ${score.toLocaleString('de-DE')} IO`;
  await member.setNickname(nick.slice(0, 32)).catch(() => {});
}

module.exports = { applyRoles, applyRolesFromActive, TIERS };
