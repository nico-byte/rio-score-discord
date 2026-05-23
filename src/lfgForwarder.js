const { EmbedBuilder } = require('discord.js');

// Role -> Target Channel -> Color in Embed
const ROLE_MAPPINGS = [
  { roleId: process.env.ROLE_TANK,   channelId: process.env.CHANNEL_TANK_LFG,   color: 0x3498db, name: 'Tank' },
  { roleId: process.env.ROLE_HEALER, channelId: process.env.CHANNEL_HEALER_LFG, color: 0x2ecc71, name: 'Healer' },
  { roleId: process.env.ROLE_DPS,    channelId: process.env.CHANNEL_DPS_LFG,    color: 0xe74c3c, name: 'DPS' },
];

function startLfgForwarder(client) {
  client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const forumId = process.env.LFG_FORUM_ID;
    if (!forumId) return;

    if (message.channel.isThread() && message.channel.parentId === forumId) {
      
      // 1. Filter role from mentions to determine required Rio score
      let requiredRio = 'Keine spezifische Anforderung';
      if (message.mentions.roles.has(process.env.ROLE_HARDCORE_PUSHER)) {
        requiredRio = '🟣 Hardcore Pusher 4k+';
      } else if (message.mentions.roles.has(process.env.ROLE_EXTREME_PUSHER)) {
        requiredRio = '🟤 Extreme Pusher 3k5k+';
      } else if (message.mentions.roles.has(process.env.ROLE_PUSHER)) {
        requiredRio = '🟠 Pusher 3k+';
      }

      // 2. Extract key level from thread title (e.g. "Magister's Terrace +15") - looks for a number with optional "+" prefix
      const title = message.channel.name;
      const keyLevelMatch = title.match(/\+?\d+/);
      const keyLevel = keyLevelMatch ? keyLevelMatch[0] : 'Unbekannt';
      
      // 3. Extract applied tags to determine dungeon name
      const forumChannel = message.channel.parent;
      const appliedTagIds = message.channel.appliedTags; // Array der Tag-IDs im Thread

      // Match applied tag IDs with forumChannel.availableTags to get Tag-Namen
      const appliedTags = forumChannel.availableTags
        .filter(tag => appliedTagIds.includes(tag.id))
        .map(tag => tag.name);

      // Join tag names with comma or fallback to "Kein Tag gesetzt"
      const dungeonName = appliedTags.length > 0 ? appliedTags.join(', ') : 'Kein Tag gesetzt';

      // 4. Check if Tank, Healer or DPS were mentioned
      for (const mapping of ROLE_MAPPINGS) {
        if (!mapping.roleId || !mapping.channelId) continue;

        if (message.mentions.roles.has(mapping.roleId)) {
          const targetChannel = client.channels.cache.get(mapping.channelId);
          if (!targetChannel) continue;

          // Build Summary-Embed
          const embed = new EmbedBuilder()
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setTitle(`LFG: ${mapping.name} gesucht!`)
            .addFields(
              { name: 'Dungeon', value: dungeonName, inline: true },
              { name: 'Key Level', value: keyLevel, inline: true },
              { name: 'Gesuchter Score', value: requiredRio, inline: false },
              { name: 'Details & Join', value: `[👉 Klicke hier, um zum Thread zu gelangen](${message.url})`, inline: false }
            )
            .setColor(mapping.color)
            .setFooter({ text: 'Wird automatisch nach 1 Stunde gelöscht' })
            .setTimestamp();

          try {
            const forwardedMsg = await targetChannel.send({ embeds: [embed] });
            
            // Auto-Delete after 1h
            setTimeout(() => {
              forwardedMsg.delete().catch(() => {});
            }, 60 * 60 * 1000);
            
          } catch (err) {
            console.error(`Fehler beim Weiterleiten an ${mapping.name}:`, err);
          }
        }
      }
    }
  });
}

module.exports = { startLfgForwarder };