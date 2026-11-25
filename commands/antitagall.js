
const enabledGroups = new Set();

export default {
  name: 'antitagall',
  enabledGroups,

  run: async ({ sock, msg, from, sender, args }) => {
    try {
      if (!from.endsWith('@g.us')) {
        return sock.sendMessage(from, {
          text: '❌ This command only works in groups.'
        }, { quoted: msg });
      }

      const metadata = await sock.groupMetadata(from);

      const member = metadata.participants.find(p =>
        [p.id, p.lid, p.phoneNumber].includes(sender)
      );

      if (
        !member ||
        (member.admin !== 'admin' &&
         member.admin !== 'superadmin')
      ) {
        return sock.sendMessage(from, {
          text: '❌ Only group admins can change this setting.'
        }, { quoted: msg });
      }

      const action = (args[0] || '').toLowerCase();

      if (action === 'on') {
        enabledGroups.add(from);

        return sock.sendMessage(from, {
          text: '✅ Anti-Tag All protection is now ON.'
        }, { quoted: msg });
      }

      if (action === 'off') {
        enabledGroups.delete(from);

        return sock.sendMessage(from, {
          text: '🔴 Anti-Tag All protection is now OFF.'
        }, { quoted: msg });
      }

      return sock.sendMessage(from, {
        text: 'Use .antitagall on or .antitagall off'
      }, { quoted: msg });

    } catch (error) {
      console.error('AntiTagAll Command Error:', error);
    }
  }
};
