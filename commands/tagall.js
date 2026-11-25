
export default {
  name: 'tagall',

  run: async ({ sock, msg, from, sender }) => {
    try {
      if (!from.endsWith('@g.us')) {
        return sock.sendMessage(from, {
          text: '❌ This command only works in groups.'
        }, { quoted: msg });
      }

      const metadata = await sock.groupMetadata(from);

      const senderInfo = metadata.participants.find(
        p => p.id === sender
      );

      if (
        !senderInfo ||
        (senderInfo.admin !== 'admin' &&
         senderInfo.admin !== 'superadmin')
      ) {
        return sock.sendMessage(from, {
          text: '❌ Only group admins can use this command.'
        }, { quoted: msg });
      }

      const members = metadata.participants;
      const mentions = members.map(member => member.id);

      const text = members
        .map((member, index) =>
          `${index + 1}. @${member.id.split('@')[0]}`
        )
        .join('\n');

      await sock.sendMessage(from, {
        text: `📢 *VIPPER-MD GROUP TAG*\n\n${text}`,
        mentions
      }, { quoted: msg });

    } catch (error) {
      console.error('TagAll Error:', error);
      await sock.sendMessage(from, {
        text: '❌ Could not tag group members.'
      }, { quoted: msg });
    }
  }
};
