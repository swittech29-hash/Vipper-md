import fs from 'fs';
import { fileURLToPath } from 'url';
import * as baileysNs from '@whiskeysockets/baileys';
import { getSettings, updateSettings } from './settings.js';

// Works with both Baileys 6.x (CommonJS) and 7.x (ESM)
const b =
  baileysNs.default && typeof baileysNs.default === 'object'
    ? baileysNs.default
    : baileysNs;
const { jidNormalizedUser } = b;

const OWNER = 'SwiftTech';
const AWAY_MS = 15 * 60 * 1000; // "back online" message only after being away this long
const SAVE_EVERY_MS = 2 * 60 * 1000; // how often we note that the bot is still online

// The same picture the menu uses (menu.jpg in the main folder)
const imagePath = fileURLToPath(new URL('../menu.jpg', import.meta.url));
const image = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timers = new Map(); // sessionId -> interval

function welcomeText(config, id) {
  const s = getSettings(id);
  const prefix = s.prefix || config.prefix;
  return (
    `✅ *Connected successfully!*\n\n` +
    `Welcome to *${config.botName}* 👑\n` +
    `Powered by *${OWNER}*\n\n` +
    `Prefix: *${prefix}*  |  Mode: *${s.mode}*\n` +
    `Type *${prefix}menu* to see all commands.`
  );
}

/**
 * Call when a number connects.
 * - First connection after pairing: welcome message to that number's own chat.
 * - Later: stays quiet, unless it was offline for a while ("back online").
 */
export async function onConnected(sock, config, id = 'main', { delayMs = 3000 } = {}) {
  const s = getSettings(id);
  const away = s.lastOnlineAt ? Date.now() - s.lastOnlineAt : 0;
  const me = jidNormalizedUser(sock.user.id);

  try {
    if (!s.welcomed) {
      await sleep(delayMs); // give the connection a moment to settle
      const text = welcomeText(config, id);
      try {
        if (image) await sock.sendMessage(me, { image, caption: text });
        else await sock.sendMessage(me, { text });
      } catch {
        await sock.sendMessage(me, { text }); // picture failed, send plain text
      }
      await updateSettings({ welcomed: true }, id);
      console.log(`[welcome:${id}] welcome message sent`);
    } else if (away > AWAY_MS) {
      await sleep(delayMs);
      await sock.sendMessage(me, { text: `✅ *${config.botName}* is back online.` });
      console.log(`[welcome:${id}] back-online message sent`);
    }
  } catch (err) {
    // welcomed stays false if sending failed, so it is tried again on the next connect
    console.error(`[welcome:${id}] could not send:`, err?.message || err);
  }

  await updateSettings({ lastOnlineAt: Date.now() }, id);
  clearInterval(timers.get(id));
  timers.set(
    id,
    setInterval(() => updateSettings({ lastOnlineAt: Date.now() }, id), SAVE_EVERY_MS)
  );
}

export function onDisconnected(id = 'main') {
  clearInterval(timers.get(id));
  timers.delete(id);
}

// Call after the session is wiped (logged out), so the next pairing gets a welcome again
export async function resetWelcome(id = 'main') {
  await updateSettings({ welcomed: false, lastOnlineAt: null }, id);
}
