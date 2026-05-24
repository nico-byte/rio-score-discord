const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('../../../db');

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

  // Cancel all other pending/approved applications for this player
  await db.cancelOtherApplications(interaction.user.id, appId);

  // Give applicant view access to the mgmt channel so they can coordinate
  const group = await db.getLfgGroup(app.lfg_id);
  const guild  = interaction.guild;

  if (group?.mgmt_channel_id) {
    const mgmtChannel = guild.channels.cache.get(group.mgmt_channel_id);
    if (mgmtChannel) {
      await mgmtChannel.permissionOverwrites.edit(interaction.user.id, {
        ViewChannel:        true,
        SendMessages:       true,
        ReadMessageHistory: true,
      }).catch(() => {});

      await mgmtChannel.send(`✅ <@${interaction.user.id}> hat die Einladung angenommen!`).catch(() => {});
    }
  }

  // Edit invite message to remove buttons
  await interaction.message.edit({
    content:    `✅ <@${interaction.user.id}> hat die Einladung angenommen!`,
    components: [],
  }).catch(() => {});

  // Silently update/cancel other invite messages for this user's cancelled applications
  const inviteChannel = guild.channels.cache.get(process.env.CHANNEL_PENDING_INVITES);
  if (inviteChannel) {
    // We can't efficiently query all cancelled apps here, but cancelOtherApplications
    // already updated the DB. The invite messages will just show stale buttons until
    // the user tries to click them (handleAccept/Decline will reject with "not valid").
    // For a cleaner UX, we'd need to fetch them — but that requires extra DB lookups.
    // Acceptable trade-off for now.
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
    const mgmtChannel = guild.channels.cache.get(group.mgmt_channel_id);
    if (mgmtChannel) {
      await mgmtChannel.send(`❌ <@${interaction.user.id}> hat die Einladung abgelehnt. Ein Platz ist wieder frei.`).catch(() => {});
    }
  }

  await interaction.message.edit({
    content:    `❌ Du hast die Einladung abgelehnt.`,
    components: [],
  }).catch(() => {});
}

module.exports = { handleAccept, handleDecline };
