import * as baileysNs from '@whiskeysockets/baileys';
import pino from 'pino';

// Loaded this way so the command still loads (and shows in the menu) even if
// lib/features.js is an older version without the saved-copy helper.
let getViewOnce = () => null;
try {
  const mod = await import('../lib/features.js');
  if (typeof mod.getViewOnce === 'function') getViewOnce = mod.getViewOnce;
  else console.error('[v1] lib/features.js is an old version: replace it with the latest one.');
} catch (err) {
  console.error('[v1] could not load lib/features.js:', err.message);
}

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
  async run({ sock, sessionId, msg, from }) {
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

      // Prefer the copy saved when the message arrived: the quoted copy
      // usually has no download link left in it.
      const saved = getViewOnce(sessionId, ctx.stanzaId);
      console.log(`[v1:${sessionId}] looking for`, ctx.stanzaId, '| saved copy found:', !!saved);
      const source = saved?.message || quoted;

      const q = source.ephemeralMessage?.message || source;
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
        key: saved?.key || {
          remoteJid: from,
          id: ctx.stanzaId,
          participant: ctx.participant,
          fromMe: false,
        },
        message: inner,
      };

      let buffer;
      try {
        buffer = await downloadMediaMessage(
          target,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );
      } catch (err) {
        if (!saved) {
          return say(
            "❌ I didn't see that message arrive. It was probably sent while the bot was offline, " +
              'or before this update. View once messages sent from now on will work.'
          );
        }
        throw err;
      }

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
