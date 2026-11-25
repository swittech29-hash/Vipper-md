
export default {
  name: 'antitagall',

  run: async ({ sock, msg, from, sender }) => {
    try {
      if (!from.endsWith('@g.us')) {
        return sock.sendMessage(from, {
          text: '❌ This command only works in groups.'
        }, { quoted: msg });
      }

      await sock.sendMessage(from, {
        text: '✅ VIPPER-MD Anti-Tag All command is working!'
      }, { quoted: msg });

    } catch (error) {
      console.error('Anti-Tag All Error:', error);
    }
  }
};
