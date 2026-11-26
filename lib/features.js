import pino from 'pino';
import * as baileysNs from '@whiskeysockets/baileys';
import { getSettings } from './settings.js';

// Works with both Baileys 6.x (CommonJS) and 7.x (ESM)
const b =
  baileysNs.default && typeof baileysNs.default === 'object'
    ? baileysNs.default
    : baileysNs;
const { downloadMediaMessage, jidNormalizedUser } = b;

const logger = pino({ level: 'silent' });
const EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '🙏', '👏', '💯'];
const MAX_STORE = 400;
const MAX_STATUS_BYTES = 30 * 1024 * 1024;

const store = new Map(); // message id -> message (for anti-delete and anti-edit)
const handled = new Set(); // events already reported, so nothing is sent twice
const lastReact = new Map(); // chat -> time of last auto reaction

const remember = (set, key) => {
  set.add(key);
  if (set.size > 1000) set.delete(set.values().next().value);
};

const unwrap = (message) =>
  message?.ephemeralMessage?.message ||
  message?.viewOnceMessage?.message ||
  message?.viewOnceMessageV2?.message ||
  message?.documentWithCaptionMessage?.message ||
  message;

const textOf = (message) => {
  const m = unwrap(message);
  return m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || m?.videoMessage?.caption || '';
};

const isRevoke = (t) => t === 0 || t === 'REVOKE';
const isEdit = (t) => t === 14 || t === 'MESSAGE_EDIT';

export function attachFeatures(sock) {
  const me = () => jidNormalizedUser(sock.user.id);
  const groupNames = new Map();

  async function chatLabel(jid) {
    if (!jid.endsWith('@g.us')) return 'private chat';
    if (!groupNames.has(jid)) {
      try {
        groupNames.set(jid, (await sock.groupMetadata(jid)).subject);
      } catch {
        groupNames.set(jid, 'a group');
      }
    }
    return `group: ${groupNames.get(jid)}`;
  }

  const who = (msg) => {
    const jid = msg.key.participant || msg.key.remoteJid || '';
    return `${msg.pushName || 'Unknown'} (${String(jid).split('@')[0]})`;
  };

  // Send a copy of a stored message (text or media) to your own chat
  async function sendCopy(stored, header) {
    const m = unwrap(stored.message);
    const to = me();
    if (m?.imageMessage || m?.videoMessage || m?.audioMessage || m?.stickerMessage) {
      try {
        const buffer = await downloadMediaMessage(stored, 'buffer', {}, {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        });
        if (m.imageMessage) {
          return sock.sendMessage(to, { image: buffer, caption: `${header}\n${m.imageMessage.caption || ''}`.trim() });
        }
        if (m.videoMessage) {
          return sock.sendMessage(to, { video: buffer, caption: `${header}\n${m.videoMessage.caption || ''}`.trim() });
        }
        await sock.sendMessage(to, { text: header });
        if (m.audioMessage) return sock.sendMessage(to, { audio: buffer, mimetype: m.audioMessage.mimetype || 'audio/ogg; codecs=opus', ptt: !!m.audioMessage.ptt });
        return sock.sendMessage(to, { sticker: buffer });
      } catch {
        return sock.sendMessage(to, { text: `${header}\n[the media could not be recovered]` });
      }
    }
    return sock.sendMessage(to, { text: `${header}\n${textOf(stored.message) || '[unsupported message type]'}` });
  }

  async function reportDeleted(id) {
    const stored = store.get(id);
    if (!id || !stored || handled.has(`d:${id}`)) return;
    remember(handled, `d:${id}`);
    const header = `🗑️ *Deleted message*\n👤 ${who(stored)}\n💬 ${await chatLabel(stored.key.remoteJid)}\n`;
    await sendCopy(stored, header);
  }

  async function reportEdited(id, newText) {
    const stored = store.get(id);
    if (!id || !stored || !newText || handled.has(`e:${id}:${newText}`)) return;
    const oldText = textOf(stored.message);
    if (oldText === newText) return;
    remember(handled, `e:${id}:${newText}`);
    await sock.sendMessage(
      me(),
      {
        text:
          `✏️ *Edited message*\n👤 ${who(stored)}\n💬 ${await chatLabel(stored.key.remoteJid)}\n\n` +
          `*Before:* ${oldText || '[no text]'}\n*After:* ${newText}`,
      }
    );
    store.set(id, { ...stored, message: { conversation: newText } });
  }

  async function saveStatus(msg) {
    const m = unwrap(msg.message);
    const from = `${msg.pushName || 'Contact'} (${String(msg.key.participant || '').split('@')[0]})`;
    const header = `📥 *Status* from ${from}`;
    const media = m?.imageMessage || m?.videoMessage;
    if (media) {
      if (Number(media.fileLength || 0) > MAX_STATUS_BYTES) return;
      const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
      const caption = `${header}\n${media.caption || ''}`.trim();
      return sock.sendMessage(me(), m.imageMessage ? { image: buffer, caption } : { video: buffer, caption });
    }
    const text = textOf(msg.message);
    if (text) await sock.sendMessage(me(), { text: `${header}\n${text}` });
  }

  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open' && getSettings().ghost) {
      sock.sendPresenceUpdate('unavailable').catch(() => {});
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const s = getSettings();
    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const jid = msg.key.remoteJid;
        if (!jid) continue;

        // Deleted or edited messages arrive as protocol messages
        const pm = unwrap(msg.message)?.protocolMessage;
        if (pm) {
          if (isRevoke(pm.type) && s.antidelete) await reportDeleted(pm.key?.id);
          if (isEdit(pm.type) && s.antiedit) await reportEdited(pm.key?.id, textOf(pm.editedMessage));
          continue;
        }

        // Status updates
        if (jid === 'status@broadcast') {
          if (msg.key.fromMe) continue;
          if (s.autostatus) await sock.readMessages([msg.key]).catch(() => {});
          if (s.autosavestatus) await saveStatus(msg).catch((e) => console.error('[features] status save:', e.message));
          continue;
        }

        if (type !== 'notify' || msg.key.fromMe) continue;

        if (s.antidelete || s.antiedit) {
          store.set(msg.key.id, msg);
          if (store.size > MAX_STORE) store.delete(store.keys().next().value);
        }

        if (s.autoread) await sock.readMessages([msg.key]).catch(() => {});

        if ((s.autotyping || s.autorecording) && !s.ghost) {
          await sock.sendPresenceUpdate(s.autorecording ? 'recording' : 'composing', jid).catch(() => {});
          setTimeout(() => sock.sendPresenceUpdate('paused', jid).catch(() => {}), 4000);
        }

        // Auto reactions: private chats only, and not more than one every 2 seconds per chat
        if (s.autoreact && !jid.endsWith('@g.us') && Date.now() - (lastReact.get(jid) || 0) > 2000) {
          lastReact.set(jid, Date.now());
          const text = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
          await sock.sendMessage(jid, { react: { text, key: msg.key } }).catch(() => {});
        }
      } catch (err) {
        console.error('[features] error:', err.message);
      }
    }
  });

  // Older Baileys versions report deletes and edits here instead
  sock.ev.on('messages.update', async (updates) => {
    const s = getSettings();
    for (const u of updates) {
      try {
        const id = u.key?.id;
        if (s.antidelete && (u.update?.messageStubType === 1 || u.update?.message === null)) {
          await reportDeleted(id);
        }
        const edited =
          u.update?.message?.editedMessage?.message?.protocolMessage?.editedMessage ||
          u.update?.message?.protocolMessage?.editedMessage;
        if (s.antiedit && edited) await reportEdited(id, textOf(edited));
      } catch (err) {
        console.error('[features] update error:', err.message);
      }
    }
  });
}
