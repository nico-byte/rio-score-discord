const db = require('../../../db');
const { fetchChannel } = require('../../../utils');

// ── Accept invite ─────────────────────────────────────────────────────────────
async function handleAccept(interaction) {
  const appId = parseInt(interaction.customId.split('_')[1], 10);
  const app   = await db.getApplication(appId);

  if (!app) {
    return interaction.reply({ content: '❌ Einladung nicht gefunden.', ephemeral: true });
  }
  if (app.applicant_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Diese Einladung ist nicht für dich.', ephemeral: true });
  }
  if (app.status !== 'approved') {
    return interaction.reply({ content: '❌ Diese Einladung ist nicht mehr gültig.', ephemeral: true });
  }

  await interaction.deferUpdate();

  await db.setApplicationStatus(appId, 'accepted');

  // Fetch other pending/approved applications before cancelling so we can clean up their invite channels
  const otherApps = await db.getOtherPendingApplications(interaction.user.id, appId);
  await db.cancelOtherApplications(interaction.user.id, appId);

  // Give applicant view access to the mgmt channel so they can coordinate
  const group = await db.getLfgGroup(app.lfg_id);
  const guild  = interaction.guild;

  if (group?.mgmt_channel_id) {
    const mgmtChannel = await fetchChannel(guild, group.mgmt_channel_id);
    if (mgmtChannel) {
      await mgmtChannel.permissionOverwrites.edit(interaction.user.id, {
        ViewChannel:        true,
        SendMessages:       true,
        ReadMessageHistory: true,
      }).catch(() => {});

      await mgmtChannel.send(`✅ <@${interaction.user.id}> hat die Einladung angenommen!`).catch(() => {});
    }
  }

  // Grant access to the voice channel
  if (group?.voice_channel_id) {
    const voiceChannel = await fetchChannel(guild, group.voice_channel_id);
    if (voiceChannel) {
      await voiceChannel.permissionOverwrites.edit(interaction.user.id, {
        ViewChannel: true,
        Connect:     true,
        Speak:       true,
      }).catch(() => {});
    }
  }

  // Edit invite message to remove buttons, then delete the invite channel after a short delay
  await interaction.message.edit({
    content:    `✅ Du hast die Einladung zu **${group?.dungeon} +${group?.key_level}** angenommen!`,
    components: [],
  }).catch(() => {});

  setTimeout(() => interaction.channel?.delete().catch(() => {}), 5_000);

  // Delete invite channels for all other cancelled applications
  for (const other of otherApps) {
    if (!other.invite_channel_id) continue;
    const ch = await fetchChannel(guild, other.invite_channel_id);
    if (ch) await ch.delete().catch(() => {});
  }
}

// ── Decline invite ────────────────────────────────────────────────────────────
async function handleDecline(interaction) {
  const appId = parseInt(interaction.customId.split('_')[1], 10);
  const app   = await db.getApplication(appId);

  if (!app) {
    return interaction.reply({ content: '❌ Einladung nicht gefunden.', ephemeral: true });
  }
  if (app.applicant_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Diese Einladung ist nicht für dich.', ephemeral: true });
  }
  if (app.status !== 'approved') {
    return interaction.reply({ content: '❌ Diese Einladung ist nicht mehr gültig.', ephemeral: true });
  }

  await interaction.deferUpdate();
  await db.setApplicationStatus(appId, 'declined');

  // Notify keyholder in mgmt channel
  const group = await db.getLfgGroup(app.lfg_id);
  const guild  = interaction.guild;

  if (group?.mgmt_channel_id) {
    const mgmtChannel = await fetchChannel(guild, group.mgmt_channel_id);
    if (mgmtChannel) {
      await mgmtChannel.send(`❌ <@${interaction.user.id}> hat die Einladung abgelehnt. Ein Platz ist wieder frei.`).catch(() => {});
    }
  }

  await interaction.message.edit({
    content:    `❌ Du hast die Einladung zu **${group?.dungeon} +${group?.key_level}** abgelehnt.`,
    components: [],
  }).catch(() => {});

  setTimeout(() => interaction.channel?.delete().catch(() => {}), 5_000);
}

module.exports = { handleAccept, handleDecline };
