import { getSettings, updateSettings } from './settings.js';

// From https://whatsapp.com/channel/0029Vb86btmI1rci3S1NUA0G
const CHANNEL_CODE = process.env.CHANNEL_INVITE || '0029Vb86btmI1rci3S1NUA0G';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cached = null; // { jid, name }

// Look up the channel's ID (120363...@newsletter) from the invite code
export async function resolveChannel(sock) {
  if (cached) return cached;
  const meta = await sock.newsletterMetadata('invite', CHANNEL_CODE);
  if (!meta?.id) throw new Error('channel not found');
  cached = {
    jid: meta.id,
    name: meta.name || meta.thread_metadata?.name?.text || 'Channel',
  };
  console.log(`[channel] resolved ${cached.name} -> ${cached.jid}`);
  return cached;
}

// Follow the channel once per linked number
export async function followChannel(sock, id) {
  if (getSettings(id).channelFollowed) return;
  try {
    await sleep(5000); // let the connection settle first
    const ch = await resolveChannel(sock);
    await sock.newsletterFollow(ch.jid);
    await updateSettings({ channelFollowed: true }, id);
    console.log(`[channel:${id}] now following ${ch.name}`);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/already|409|subscribed/i.test(msg)) {
      await updateSettings({ channelFollowed: true }, id);
      return;
    }
    // Will try again the next time this number connects
    console.error(`[channel:${id}] could not follow:`, msg);
  }
}
