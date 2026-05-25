const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../../../db');
const { sessionSet, sessionGet, sessionDelete, fetchChannel } = require('../../../utils');

const ROLE_LABELS = { tank: '🛡️ Tank', healer: '💚 Healer', dps: '⚔️ DPS' };

const DUNGEON_ABBR = {
  "Magister's Terrace":      'mt',
  'Maisara Caverns':         'mc',
  'Nexus Point Xenas':       'npx',
  'Windrunner Spire':        'ws',
  "Algeth'ar Academy":       'aa',
  'Seat of the Triumvirate': 'seat',
  'Skyreach':                'sr',
  'Pit of Saron':            'pos',
};

// ── Role-picker sessions: keyholder userId → { appId, selectedRole } ─────────
const approvalSessions = new Map();

// ── Helper: edit the mgmt card to show a resolved state ──────────────────────
async function editMgmtCard(msg, app, statusText) {
  try {
    await msg.edit({
      embeds: msg.embeds,
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

// ── Internal: creates invite channel, sends invite, notifies mgmt ─────────────
async function doApprove(client, guild, appId, app, group, approvedRole) {
  if (approvedRole) await db.setApplicationApprovedRole(appId, approvedRole);

  const botId = client.user.id;

  const charRows   = await Promise.all(app.char_ids.map(id => db.getCharacterById(id)));
  const validChars = charRows.filter(Boolean);
  const charLines  = validChars.map(c => `• ${c.char_name} — ${c.realm} (${c.class ?? '?'} / ${c.spec ?? '?'} • ${c.rio_score ?? 0} IO)`).join('\n');

  let applicant;
  try { applicant = await guild.members.fetch(app.applicant_id); } catch { applicant = null; }

  const voiceChannel = group.voice_channel_id ? await fetchChannel(guild, group.voice_channel_id) : null;

  const inviteEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`Einladung: ${group.dungeon} +${group.key_level}`)
    .setAuthor({ name: applicant?.displayName ?? app.applicant_id, iconURL: applicant?.user.displayAvatarURL() })
    .addFields(
      { name: 'Dungeon',     value: group.dungeon,        inline: true },
      { name: 'Key Level',   value: `+${group.key_level}`, inline: true },
      ...(approvedRole ? [{ name: 'Deine Rolle', value: ROLE_LABELS[approvedRole] ?? approvedRole, inline: true }] : []),
      { name: 'Charaktere',  value: charLines || '—',      inline: false },
      ...(voiceChannel ? [{ name: 'Voice Channel', value: `${voiceChannel}`, inline: false }] : []),
    )
    .setFooter({ text: 'Annehmen oder Ablehnen — Annehmen bricht alle anderen Bewerbungen ab' })
    .setTimestamp();

  // Create temporary private invite channel
  const abbr     = DUNGEON_ABBR[group.dungeon] ?? group.dungeon.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 10);
  const safeName = `invite-${abbr}-${group.key_level}`;

  let inviteChannel;
  try {
    inviteChannel = await guild.channels.create({
      name:   safeName,
      type:   ChannelType.GuildText,
      parent: process.env.LFG_CATEGORY_ID ?? null,
      permissionOverwrites: [
        { id: guild.id,          deny:  [PermissionFlagsBits.ViewChannel] },
        { id: botId,             allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels] },
        { id: app.applicant_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
      ],
    });
    await inviteChannel.setPosition(0).catch(() => {});
  } catch (err) {
    console.error('Failed to create invite channel:', err);
  }

  const mgmtCh  = group.mgmt_channel_id ? await fetchChannel(guild, group.mgmt_channel_id) : null;
  const mgmtMsg = mgmtCh && app.mgmt_message_id
    ? await mgmtCh.messages.fetch(app.mgmt_message_id).catch(() => null)
    : null;

  if (!inviteChannel) {
    if (mgmtMsg) await editMgmtCard(mgmtMsg, app, '✅ Angenommen — Channel-Erstellung fehlgeschlagen');
    return;
  }

  let inviteMsg;
  try {
    inviteMsg = await inviteChannel.send({
      content:    `<@${app.applicant_id}> Du wurdest zu **${group.dungeon} +${group.key_level}** eingeladen!`,
      embeds:     [inviteEmbed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`lfgaccept_${appId}`).setLabel('Annehmen').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`lfgdecline_${appId}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
        ),
      ],
    });
  } catch (err) {
    console.error('Failed to post invite:', err);
    await inviteChannel.delete().catch(() => {});
  }

  await Promise.all([
    inviteMsg ? db.setApplicationInviteMsg(appId, inviteMsg.id) : Promise.resolve(),
    db.setApplicationInviteChannel(appId, inviteChannel.id),
  ]);

  if (mgmtCh) {
    await mgmtCh.send(`✅ Einladung an <@${app.applicant_id}> gesendet → ${inviteChannel}`).catch(() => {});
  }
  if (mgmtMsg) await editMgmtCard(mgmtMsg, app, '✅ Angenommen — Invite gesendet');
}

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

  // Read role from session (keyholder used the inline dropdown) or default to first offered
  const rolesOffered = app.roles_offered ?? [];
  const session      = sessionGet(approvalSessions, interaction.user.id);
  const approvedRole = session?.selectedRole ?? rolesOffered[0] ?? null;
  sessionDelete(approvalSessions, interaction.user.id);

  await interaction.deferUpdate();
  await db.setApplicationStatus(appId, 'approved');
  await doApprove(interaction.client, interaction.guild, appId, app, group, approvedRole);
}

// ── Role picker: select update ────────────────────────────────────────────────
async function handleApproveRoleSelect(interaction) {
  const session = sessionGet(approvalSessions, interaction.user.id);
  if (!session) {
    return interaction.update({ content: '❌ Sitzung abgelaufen.', components: [] });
  }
  session.selectedRole = interaction.values[0];
  await interaction.deferUpdate();
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

  if (app.invite_channel_id) {
    const inviteCh = await fetchChannel(interaction.guild, app.invite_channel_id);
    if (inviteCh) await inviteCh.delete().catch(() => {});
  }

  await editMgmtCard(interaction.message, app, '❌ Abgelehnt');
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

  const announcements = await db.getLfgAnnouncements(lfgId);
  for (const ann of announcements) {
    try {
      const ch  = await fetchChannel(guild, ann.channel_id);
      const msg = ch ? await ch.messages.fetch(ann.message_id) : null;
      if (msg) await msg.delete();
    } catch { /* already gone */ }
  }
  await db.deleteLfgAnnouncements(lfgId);

  const apps = await db.getLfgApplications(lfgId);
  for (const app of apps) {
    if (!['pending', 'approved'].includes(app.status)) continue;
    await db.setApplicationStatus(app.id, 'cancelled');
    if (app.invite_channel_id) {
      const inviteCh = await fetchChannel(guild, app.invite_channel_id);
      if (inviteCh) await inviteCh.delete().catch(() => {});
    }
  }

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

  const announcements = await db.getLfgAnnouncements(lfgId);
  for (const ann of announcements) {
    try {
      const ch  = await fetchChannel(guild, ann.channel_id);
      const msg = ch ? await ch.messages.fetch(ann.message_id) : null;
      if (msg) await msg.delete();
    } catch { /* already gone */ }
  }
  await db.deleteLfgAnnouncements(lfgId);

  const apps = await db.getLfgApplications(lfgId);
  for (const app of apps) {
    if (!['pending', 'approved'].includes(app.status)) continue;
    await db.setApplicationStatus(app.id, 'cancelled');
    if (app.invite_channel_id) {
      const inviteCh = await fetchChannel(guild, app.invite_channel_id);
      if (inviteCh) await inviteCh.delete().catch(() => {});
    }
  }

  if (group.voice_channel_id) {
    const voiceChannel = await fetchChannel(guild, group.voice_channel_id);
    if (voiceChannel) await voiceChannel.delete().catch(() => {});
  }

  const mgmtChannel = await fetchChannel(guild, group.mgmt_channel_id);
  if (mgmtChannel) {
    await mgmtChannel.send('✅ LFG beendet. Dieser Channel wird in 10 Sekunden gelöscht.').catch(() => {});
    setTimeout(() => mgmtChannel.delete().catch(() => {}), 10_000);
  }
}

module.exports = {
  handleApprove, handleApproveRoleSelect,
  handleReject, handleStart, handleClose,
};
