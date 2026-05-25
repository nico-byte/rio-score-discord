const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const db = require('../../../db');
const { fetchChannel } = require('../../../utils');

// ── Approve application ───────────────────────────────────────────────────────
async function handleApprove(interaction) {
  const appId = parseInt(interaction.customId.split('_')[1], 10);
  const app   = await db.getApplication(appId);

  if (!app) {
    return interaction.reply({ content: '❌ Bewerbung nicht gefunden.', ephemeral: true });
  }
  if (app.status !== 'pending') {
    return interaction.reply({ content: `❌ Bewerbung ist bereits **${app.status}**.`, ephemeral: true });
  }

  const group = await db.getLfgGroup(app.lfg_id);
  if (!group || group.status !== 'open') {
    return interaction.reply({ content: '❌ Diese LFG ist nicht mehr offen.', ephemeral: true });
  }
  if (group.creator_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Nur der Keyholder kann Bewerbungen annehmen.', ephemeral: true });
  }

  const spotsLeft = await db.getLfgSpotsLeft(app.lfg_id);
  if (spotsLeft <= 0) {
    return interaction.reply({ content: '❌ Die Gruppe ist bereits voll.', ephemeral: true });
  }

  await interaction.deferUpdate();
  await db.setApplicationStatus(appId, 'approved');

  // Post invite in #pending-invites
  const guild          = interaction.guild;
  const inviteChannelId = process.env.CHANNEL_PENDING_INVITES;
  const inviteChannel  = inviteChannelId ? await fetchChannel(guild, inviteChannelId) : null;

  if (!inviteChannel) {
    console.warn('CHANNEL_PENDING_INVITES not configured or not found');
    await editMgmtCard(interaction, app, '✅ Angenommen — Invite-Channel nicht konfiguriert');
    return;
  }

  // Fetch chars for the invite message
  const charRows  = await Promise.all(app.char_ids.map(id => db.getCharacterById(id)));
  const validChars = charRows.filter(Boolean);
  const charLines  = validChars.map(c => `• ${c.char_name} — ${c.realm} (${c.class ?? '?'} / ${c.spec ?? '?'} • ${c.rio_score ?? 0} IO)`).join('\n');

  // Fetch applicant user
  let applicant;
  try { applicant = await guild.members.fetch(app.applicant_id); } catch { applicant = null; }

  const voiceChannel = group.voice_channel_id ? await fetchChannel(guild, group.voice_channel_id) : null;

  const inviteEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`Einladung: ${group.dungeon} +${group.key_level}`)
    .setAuthor({ name: applicant?.displayName ?? app.applicant_id, iconURL: applicant?.user.displayAvatarURL() })
    .addFields(
      { name: 'Dungeon',     value: group.dungeon,         inline: true },
      { name: 'Key Level',   value: `+${group.key_level}`,  inline: true },
      { name: 'Charaktere',  value: charLines || '—',       inline: false },
      ...(voiceChannel ? [{ name: 'Voice Channel', value: `${voiceChannel}`, inline: false }] : []),
    )
    .setFooter({ text: 'Annehmen oder Ablehnen — Annehmen bricht alle anderen Bewerbungen ab' })
    .setTimestamp();

  let inviteMsg;
  try {
    inviteMsg = await inviteChannel.send({
      content:    `<@${app.applicant_id}> Du wurdest eingeladen!`,
      embeds:     [inviteEmbed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`lfgaccept_${appId}`)
            .setLabel('Annehmen')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`lfgdecline_${appId}`)
            .setLabel('Ablehnen')
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });
  } catch (err) {
    console.error('Failed to post invite:', err);
  }

  if (inviteMsg) await db.setApplicationInviteMsg(appId, inviteMsg.id);

  await editMgmtCard(interaction, app, '✅ Angenommen — Invite gesendet');
}

// ── Reject application ────────────────────────────────────────────────────────
async function handleReject(interaction) {
  const appId = parseInt(interaction.customId.split('_')[1], 10);
  const app   = await db.getApplication(appId);

  if (!app) {
    return interaction.reply({ content: '❌ Bewerbung nicht gefunden.', ephemeral: true });
  }
  if (!['pending', 'approved'].includes(app.status)) {
    return interaction.reply({ content: `❌ Bewerbung ist bereits **${app.status}**.`, ephemeral: true });
  }

  const group = await db.getLfgGroup(app.lfg_id);
  if (group?.creator_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Nur der Keyholder kann Bewerbungen ablehnen.', ephemeral: true });
  }

  await interaction.deferUpdate();
  await db.setApplicationStatus(appId, 'rejected');

  // If there was an invite message, remove the buttons from it
  if (app.invite_message_id) {
    const guild          = interaction.guild;
    const inviteChannel  = await fetchChannel(guild, process.env.CHANNEL_PENDING_INVITES);
    if (inviteChannel) {
      try {
        const inviteMsg = await inviteChannel.messages.fetch(app.invite_message_id);
        await inviteMsg.edit({ content: `<@${app.applicant_id}> Deine Einladung wurde zurückgezogen.`, components: [] });
      } catch { /* message may already be gone */ }
    }
  }

  await editMgmtCard(interaction, app, '❌ Abgelehnt');
}

// ── Start key (close LFG search, keep voice channel) ─────────────────────────
async function handleStart(interaction) {
  const lfgId = parseInt(interaction.customId.split('_')[1], 10);
  const group  = await db.getLfgGroup(lfgId);

  if (!group) {
    return interaction.reply({ content: '❌ LFG nicht gefunden.', ephemeral: true });
  }
  if (group.creator_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Nur der Keyholder kann den Key starten.', ephemeral: true });
  }

  await interaction.deferUpdate();
  await db.closeLfgGroup(lfgId);

  const guild = interaction.guild;

  // Delete announcement messages in role channels
  const announcements = await db.getLfgAnnouncements(lfgId);
  for (const ann of announcements) {
    try {
      const ch  = await fetchChannel(guild, ann.channel_id);
      const msg = ch ? await ch.messages.fetch(ann.message_id) : null;
      if (msg) await msg.delete();
    } catch { /* already gone */ }
  }
  await db.deleteLfgAnnouncements(lfgId);

  // Cancel remaining pending/approved applications and update their invite messages
  const apps = await db.getLfgApplications(lfgId);
  const inviteChannel = await fetchChannel(guild, process.env.CHANNEL_PENDING_INVITES);

  for (const app of apps) {
    if (['pending', 'approved'].includes(app.status)) {
      await db.setApplicationStatus(app.id, 'cancelled');

      if (app.invite_message_id && inviteChannel) {
        try {
          const inviteMsg = await inviteChannel.messages.fetch(app.invite_message_id);
          await inviteMsg.edit({ content: `<@${app.applicant_id}> Der Key wurde gestartet — die LFG ist geschlossen.`, components: [] });
        } catch { /* already gone */ }
      }
    }
  }

  // Delete mgmt channel, leave voice channel open
  const mgmtChannel = await fetchChannel(guild, group.mgmt_channel_id);
  if (mgmtChannel) {
    await mgmtChannel.send('🎉 Key gestartet! Viel Erfolg! Dieser Channel wird in 10 Sekunden gelöscht.').catch(() => {});
    setTimeout(() => mgmtChannel.delete().catch(() => {}), 10_000);
  }
}

// ── Close LFG ─────────────────────────────────────────────────────────────────
async function handleClose(interaction) {
  const lfgId = parseInt(interaction.customId.split('_')[1], 10);
  const group  = await db.getLfgGroup(lfgId);

  if (!group) {
    return interaction.reply({ content: '❌ LFG nicht gefunden.', ephemeral: true });
  }
  if (group.creator_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Nur der Keyholder kann die LFG beenden.', ephemeral: true });
  }

  await interaction.deferUpdate();
  await db.closeLfgGroup(lfgId);

  const guild = interaction.guild;

  // Delete announcement messages in role channels
  const announcements = await db.getLfgAnnouncements(lfgId);
  for (const ann of announcements) {
    try {
      const ch  = await fetchChannel(guild, ann.channel_id);
      const msg = ch ? await ch.messages.fetch(ann.message_id) : null;
      if (msg) await msg.delete();
    } catch { /* already gone */ }
  }
  await db.deleteLfgAnnouncements(lfgId);

  // Cancel all pending/approved applications and update mgmt cards + invite messages
  const apps = await db.getLfgApplications(lfgId);
  const inviteChannel = await fetchChannel(guild, process.env.CHANNEL_PENDING_INVITES);

  for (const app of apps) {
    if (['pending', 'approved'].includes(app.status)) {
      await db.setApplicationStatus(app.id, 'cancelled');

      if (app.invite_message_id && inviteChannel) {
        try {
          const inviteMsg = await inviteChannel.messages.fetch(app.invite_message_id);
          await inviteMsg.edit({ content: `<@${app.applicant_id}> Die LFG wurde vom Keyholder beendet.`, components: [] });
        } catch { /* already gone */ }
      }
    }
  }

  // Delete voice channel immediately
  if (group.voice_channel_id) {
    const voiceChannel = await fetchChannel(guild, group.voice_channel_id);
    if (voiceChannel) await voiceChannel.delete().catch(() => {});
  }

  // Delete mgmt channel after a short delay so the user sees the confirmation
  const mgmtChannel = await fetchChannel(guild, group.mgmt_channel_id);
  if (mgmtChannel) {
    await mgmtChannel.send('✅ LFG beendet. Dieser Channel wird in 10 Sekunden gelöscht.').catch(() => {});
    setTimeout(() => mgmtChannel.delete().catch(() => {}), 10_000);
  }
}

// ── Helper: edit the mgmt card to show resolved state ────────────────────────
async function editMgmtCard(interaction, app, statusText) {
  try {
    // interaction.message is the mgmt card
    await interaction.message.edit({
      embeds: interaction.message.embeds,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`lfgresolved_${app.id}`)
            .setLabel(statusText)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        ),
      ],
    });
  } catch { /* not critical */ }
}

module.exports = { handleApprove, handleReject, handleStart, handleClose };
