export default {
  name: 'v1',
  description: 'Unlock a replied-to view once media',
  async run({ sock, msg, from }) {
    try {
      const ctx =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo;
      const quoted = ctx?.quotedMessage;

      if (!quoted) {
        await sock.sendMessage(from, {
          text: 'Reply to a view once image or video with !v1.'
        }, { quoted: msg });
        return;
      }

      const viewOnce =
        quoted.viewOnceMessage?.message ||
        quoted.viewOnceMessageV2?.message ||
        quoted.viewOnceMessageV2Extension?.message;

      const media = viewOnce?.imageMessage || viewOnce?.videoMessage;
      if (!media) {
        await sock.sendMessage(from, {
          text: 'The replied message is not view once image or video media.'
        }, { quoted: msg });
        return;
      }

      const message = viewOnce.imageMessage
        ? { image: await sock.downloadMediaMessage({ message: viewOnce }) }
        : { video: await sock.downloadMediaMessage({ message: viewOnce }) };

      message.caption = media.caption || '';
      await sock.sendMessage(from, message, { quoted: msg });
    } catch (error) {
      console.error('V1 command error:', error);
      await sock.sendMessage(from, {
        text: 'Could not unlock the view once media.'
      }, { quoted: msg });
    }
  }
};