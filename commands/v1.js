import * as baileysNs from '@whiskeysockets/baileys';
import pino from 'pino';

// Works with both Baileys 6.x (CommonJS) and 7.x (ESM)
const b =
  baileysNs.default && typeof baileysNs.default === 'object'
    ? baileysNs.default
    : baileysNs;
const { downloadMediaMessage, jidNormalizedUser } = b;

export default {
  name: 'v1',
  aliases: ['vv', 'viewonce'],
  category: 'TOOLS',
  owner: true,
  description: 'Save a replied-to view once photo, video or voice note (owner only)',
  async run({ sock, msg, from }) {
    // Results and errors go to your own chat, so the other person sees nothing
    const me = jidNormalizedUser(sock.user.id);
    const say = (text) => sock.sendMessage(me, { text });

    try {
      const m = msg.message?.ephemeralMessage?.message || msg.message;
      const ctx =
        m?.extendedTextMessage?.contextInfo ||
        m?.imageMessage?.contextInfo ||
        m?.videoMessage?.contextInfo;
      const quoted = ctx?.quotedMessage;

      if (!quoted) {
        return say('Reply to a view once photo, video or voice note with !v1.');
      }

      const q = quoted.ephemeralMessage?.message || quoted;
      const wrapper =
        q.viewOnceMessage?.message ||
        q.viewOnceMessageV2?.message ||
        q.viewOnceMessageV2Extension?.message;
      const inner = wrapper || q;

      const media = inner.imageMessage || inner.videoMessage || inner.audioMessage;
      // Newer WhatsApp versions mark the media itself with viewOnce: true
      if (!media || !(wrapper || media.viewOnce)) {
        return say('The replied message is not a view once photo, video or voice note.');
      }

      const target = {
        key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant, fromMe: false },
        message: inner,
      };
      const buffer = await downloadMediaMessage(
        target,
        'buffer',
        {},
        { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
      );

      const caption = media.caption || '';
      if (inner.imageMessage) {
        await sock.sendMessage(me, { image: buffer, caption });
      } else if (inner.videoMessage) {
        await sock.sendMessage(me, { video: buffer, caption, mimetype: media.mimetype });
      } else {
        await sock.sendMessage(me, {
          audio: buffer,
          mimetype: media.mimetype || 'audio/ogg; codecs=opus',
          ptt: !!media.ptt,
        });
      }
    } catch (error) {
      console.error('v1 command error:', error);
      await say('❌ Could not save that media. It may already have expired.').catch(() => {});
    }
  },
};
