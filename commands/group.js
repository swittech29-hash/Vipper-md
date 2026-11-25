// Group commands. "admin: true" means group admins (and the owner) can use it.

function contextInfo(msg) {
  const m = msg.message?.ephemeralMessage?.message || msg.message;
  return m?.extendedTextMessage?.contextInfo || {};
}

// People named by @mention, by replying to their message, or by typing a number
function getTargets(msg, args) {
  const ci = contextInfo(msg);
  const set = new Set(ci.mentionedJid || []);
  if (ci.participant && ci.quotedMessage) set.add(ci.participant);
  for (const a of args) {
    if (a.startsWith('@')) continue;
    const n = a.replace(/\D/g, '');
    if (n.length >= 7) set.add(`${n}@s.whatsapp.net`);
  }
  return [...set];
}

const tag = (jid) => `@${jid.split('@')[0]}`;

async function participantAction(ctx, action, doneText) {
  const { sock, from, msg, args, reply } = ctx;
  const targets = getTargets(msg, args);
  if (!targets.length) {
    return reply('Mention someone, reply to their message, or type their number.');
  }
  await sock.groupParticipantsUpdate(from, targets, action);
  await sock.sendMessage(from, { text: `${doneText} ${targets.map(tag).join(' ')}`, mentions: targets });
}

export default [
  {
    name: 'tagall',
    category: 'GROUP',
    admin: true,
    description: 'Tag everyone in the group',
    async run({ sock, from, msg, text }) {
      const meta = await sock.groupMetadata(from);
      const ids = meta.participants.map((p) => p.id);
      const body = `📢 *${text || 'Attention everyone!'}*\n\n${ids.map((j) => tag(j)).join('\n')}`;
      await sock.sendMessage(from, { text: body, mentions: ids }, { quoted: msg });
    },
  },
  {
    name: 'hidetag',
    aliases: ['tag'],
    category: 'GROUP',
    admin: true,
    description: 'Send a message that tags everyone silently',
    async run({ sock, from, text, reply }) {
      if (!text) return reply('Type the message to send. Example: !hidetag Meeting at 5');
      const meta = await sock.groupMetadata(from);
      await sock.sendMessage(from, { text, mentions: meta.participants.map((p) => p.id) });
    },
  },
  {
    name: 'tagadmins',
    category: 'GROUP',
    admin: true,
    description: 'Tag all group admins',
    async run({ sock, from, msg, text }) {
      const meta = await sock.groupMetadata(from);
      const ids = meta.participants.filter((p) => p.admin).map((p) => p.id);
      await sock.sendMessage(
        from,
        { text: `🛡️ *${text || 'Admins'}*\n\n${ids.map(tag).join('\n')}`, mentions: ids },
        { quoted: msg }
      );
    },
  },
  {
    name: 'kick',
    aliases: ['remove'],
    category: 'GROUP',
    admin: true,
    description: 'Remove a member',
    async run(ctx) {
      await participantAction(ctx, 'remove', '👢 Removed');
    },
  },
  {
    name: 'add',
    category: 'GROUP',
    admin: true,
    description: 'Add a member by number',
    async run(ctx) {
      await participantAction(ctx, 'add', '➕ Added');
    },
  },
  {
    name: 'promote',
    category: 'GROUP',
    admin: true,
    description: 'Make a member admin',
    async run(ctx) {
      await participantAction(ctx, 'promote', '⬆️ Promoted');
    },
  },
  {
    name: 'demote',
    category: 'GROUP',
    admin: true,
    description: 'Remove admin rights',
    async run(ctx) {
      await participantAction(ctx, 'demote', '⬇️ Demoted');
    },
  },
  {
    name: 'mute',
    category: 'GROUP',
    admin: true,
    description: 'Only admins can send messages',
    async run({ sock, from, reply }) {
      await sock.groupSettingUpdate(from, 'announcement');
      await reply('🔇 Group muted. Only admins can send messages.');
    },
  },
  {
    name: 'unmute',
    category: 'GROUP',
    admin: true,
    description: 'Everyone can send messages',
    async run({ sock, from, reply }) {
      await sock.groupSettingUpdate(from, 'not_announcement');
      await reply('🔊 Group unmuted. Everyone can send messages.');
    },
  },
  {
    name: 'lockgroup',
    category: 'GROUP',
    admin: true,
    description: 'Only admins can edit group info',
    async run({ sock, from, reply }) {
      await sock.groupSettingUpdate(from, 'locked');
      await reply('🔒 Group info is locked to admins.');
    },
  },
  {
    name: 'unlockgroup',
    category: 'GROUP',
    admin: true,
    description: 'Everyone can edit group info',
    async run({ sock, from, reply }) {
      await sock.groupSettingUpdate(from, 'unlocked');
      await reply('🔓 Group info can be edited by everyone.');
    },
  },
  {
    name: 'grouplink',
    aliases: ['link'],
    category: 'GROUP',
    admin: true,
    description: 'Get the invite link',
    async run({ sock, from, reply }) {
      const code = await sock.groupInviteCode(from);
      await reply(`🔗 https://chat.whatsapp.com/${code}`);
    },
  },
  {
    name: 'revoke',
    category: 'GROUP',
    admin: true,
    description: 'Reset the invite link',
    async run({ sock, from, reply }) {
      await sock.groupRevokeInvite(from);
      await reply('♻️ Invite link reset. The old link no longer works.');
    },
  },
  {
    name: 'setname',
    category: 'GROUP',
    admin: true,
    description: 'Change the group name',
    async run({ sock, from, text, reply }) {
      if (!text) return reply('Type the new name. Example: !setname My Group');
      await sock.groupUpdateSubject(from, text);
      await reply('✅ Group name updated.');
    },
  },
  {
    name: 'setdesc',
    category: 'GROUP',
    admin: true,
    description: 'Change the group description',
    async run({ sock, from, text, reply }) {
      if (!text) return reply('Type the new description. Example: !setdesc Be kind');
      await sock.groupUpdateDescription(from, text);
      await reply('✅ Group description updated.');
    },
  },
  {
    name: 'groupinfo',
    category: 'GROUP',
    group: true,
    description: 'Show group details',
    async run({ sock, from, reply }) {
      const meta = await sock.groupMetadata(from);
      const admins = meta.participants.filter((p) => p.admin).length;
      const created = meta.creation ? new Date(meta.creation * 1000).toDateString() : 'unknown';
      await reply(
        `👥 *${meta.subject}*\n` +
          `🆔 ${meta.id}\n` +
          `📅 Created: ${created}\n` +
          `👤 Members: ${meta.participants.length}\n` +
          `🛡️ Admins: ${admins}\n\n` +
          `📝 ${meta.desc || 'No description'}`
      );
    },
  },
  {
    name: 'jid',
    category: 'GROUP',
    description: 'Show this chat ID',
    async run({ reply, from }) {
      await reply(from);
    },
  },
  {
    name: 'leavegc',
    category: 'GROUP',
    owner: true,
    group: true,
    description: 'Make the bot leave this group',
    async run({ sock, from, reply }) {
      await reply('👋 Goodbye!');
      await sock.groupLeave(from);
    },
  },
];
