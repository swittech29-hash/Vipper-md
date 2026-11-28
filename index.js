import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pino from 'pino';
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'url';
import * as baileysNs from '@whiskeysockets/baileys';

import config from './config.js';
import { supabase, saveUser } from './lib/db.js';
import { loadSettings, getSettings, allowed, matchPrefix, runWithSession } from './lib/settings.js';
import { onConnected, onDisconnected, resetWelcome } from './lib/welcome.js';
import { attachFeatures } from './lib/features.js';
import { useSupabaseAuthState } from './lib/supabaseAuth.js';
import { followChannel } from './lib/channel.js';
import { page as renderPage, notice, homeBody, pairBody, qrBody } from './lib/portal.js';

// Works with both Baileys 6.x (CommonJS) and 7.x (ESM)
const baileys =
  baileysNs.default && typeof baileysNs.default === 'object'
    ? baileysNs.default
    : baileysNs;
const makeWASocket =
  typeof baileys.default === 'function' ? baileys.default : baileys.makeWASocket;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = baileys;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 20);

// ---------- Load commands (a broken file no longer stops startup) ----------
const commands = new Map();
const lookup = new Map();
const commandsDir = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  try {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
    const list = Array.isArray(mod.default) ? mod.default : [mod.default];
    for (const cmd of list) {
      commands.set(cmd.name, cmd);
      lookup.set(cmd.name, cmd);
      for (const alias of cmd.aliases || []) lookup.set(alias, cmd);
    }
  } catch (err) {
    console.error(`Could not load command file ${file}:`, err.message);
  }
}

console.log(`Loaded ${commands.size} command(s): ${[...commands.keys()].join(', ')}`);

function getText(msg) {
  const m =
    msg.message?.ephemeralMessage?.message ||
    msg.message?.viewOnceMessage?.message ||
    msg.message?.documentWithCaptionMessage?.message ||
    msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let cachedVersion = null;
async function getVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const { version, error } = await fetchLatestBaileysVersion();
    if (!error) cachedVersion = version;
    return version;
  } catch {
    return undefined;
  }
}

// ---------- Sessions: one entry per linked phone number ----------
// id (phone number digits, or "main" for your old session) -> {
//   id, sock, auth, isOnline, canPair, gen, timer
// }
const sessions = new Map();

function makeAuth(id) {
  return supabase
    ? useSupabaseAuthState(baileys, id)
    : useMultiFileAuthState(path.join(config.sessionDir, id));
}

async function listSavedSessions() {
  if (supabase) {
    const { data, error } = await supabase
      .from('auth_state')
      .select('id')
      .like('id', '%:creds');
    if (error) {
      console.error('Could not list saved sessions:', error.message);
      return [];
    }
    return data.map((r) => r.id.slice(0, -':creds'.length));
  }
  if (!fs.existsSync(config.sessionDir)) return [];
  return fs
    .readdirSync(config.sessionDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function scheduleReconnect(sess, delay = 3000) {
  if (sess.timer) return;
  sess.timer = setTimeout(() => {
    sess.timer = null;
    startSession(sess.id).catch((err) => {
      console.error(`[${sess.id}] start failed, retrying in 5s:`, err.message);
      scheduleReconnect(sess, 5000);
    });
  }, delay);
}

async function wipeAuth(sess) {
  try {
    if (typeof sess.auth?.clear === 'function') {
      await sess.auth.clear();
    } else if (!supabase) {
      await fs.promises.rm(path.join(config.sessionDir, sess.id), {
        recursive: true,
        force: true,
      });
    }
  } catch (err) {
    console.error(`[${sess.id}] could not clear session:`, err.message);
  }
}

async function startSession(id) {
  let sess = sessions.get(id);
  if (!sess) {
    sess = { id, sock: null, auth: null, isOnline: false, canPair: false, gen: 0, timer: null };
    sessions.set(id, sess);
  }

  const myGen = ++sess.gen;
  const auth = await makeAuth(id);
  const { state, saveCreds } = auth;
  const version = await getVersion();
  await loadSettings(config, id);

  if (myGen !== sess.gen) return sess;

  sess.auth = auth;
  sess.canPair = false;

  const s = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    qrTimeout: 120000,
    markOnlineOnConnect: !getSettings(id).ghost,
  });

  sess.sock = s;
  attachFeatures(s, id);

  s.ev.on('creds.update', saveCreds);

  s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (myGen !== sess.gen) return;

    if (qr) {
      sess.canPair = true;
      sess.qr = qr; // the pairing page shows this when someone picks "Scan QR"
    }

    if (connection === 'open') {
      sess.qr = null;

      // Linked by QR, but scanned with a different number than the one typed:
      // undo it, so each number is stored under its own name.
      const jid = String(s.user?.id || '');
      const realNumber = jid.split(':')[0].split('@')[0];
      if (sess.viaQr && jid.endsWith('@s.whatsapp.net') && realNumber && realNumber !== id) {
        console.log(`[${id}] scanned with ${realNumber} instead. Unlinking.`);
        await s.logout().catch(() => {});
        return;
      }

      sess.isOnline = true;
      sess.canPair = false;
      console.log(`✅ [${id}] ${config.botName} is online!`);
      onConnected(s, config, id).catch((e) =>
        console.error(`[${id}] welcome error:`, e?.message || e)
      );

      followChannel(s, id).catch(() => {});
    }

    if (connection === 'close') {
      sess.isOnline = false;
      sess.canPair = false;
      sess.qr = null;
      onDisconnected(id);

      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`[${id}] connection closed (code ${code}).`, loggedOut ? 'Logged out.' : '');

      // Number was unlinked from the phone: wipe it and forget it.
      if (loggedOut) {
        await wipeAuth(sess);
        await Promise.resolve(resetWelcome(id)).catch(() => {});
        sessions.delete(id);
        console.log(`[${id}] session removed.`);
        return;
      }

      // Pairing window ran out and nothing was ever linked: drop it.
      const neverLinked = !s.authState.creds.registered && code === DisconnectReason.timedOut;
      if (neverLinked) {
        await wipeAuth(sess);
        sessions.delete(id);
        console.log(`[${id}] pairing window ended, session dropped.`);
        return;
      }

      scheduleReconnect(sess, 3000);
    }
  });

  s.ev.on('messages.upsert', (ev) => runWithSession(id, async () => {
    if (myGen !== sess.gen) return; // an older socket must never reply
    const { messages, type } = ev;

    for (const msg of messages) {
      try {
        if (!msg.message) continue;

        const from = msg.key.remoteJid;
        if (!from || from === 'status@broadcast') continue;

        const age = Date.now() / 1000 - Number(msg.messageTimestamp || 0);
        if (type !== 'notify' && age > 30) continue;

        const isGroup = from.endsWith('@g.us');
        const sender = isGroup
          ? msg.key.participantAlt || msg.key.participant
          : msg.key.remoteJidAlt || from;

        if (!msg.key.fromMe) {
          Promise.resolve(saveUser(sender, msg.pushName || null)).catch(() => {});
        }

        const body = getText(msg).trim();
        if (body) {
          console.log(`[${id}] [msg] ${msg.key.fromMe ? 'me' : 'them'} ${from}: ${body.slice(0, 60)}`);
        }

        // "Owner" = the number this session is linked to (messages it sends itself)
        const isOwner = !!msg.key.fromMe;
        const sessionConfig = { ...config, prefix: getSettings(id).prefix || config.prefix };
        const usedPrefix = matchPrefix(body, isOwner, sessionConfig.prefix);
        if (!usedPrefix) continue;

        const [name, ...args] = body.slice(usedPrefix.length).split(/\s+/);
        const cmd = lookup.get(name.toLowerCase());
        if (!cmd) continue;

        if (!allowed(cmd.name, isOwner, id)) continue;

        const reply = (text, extra = {}) =>
          s.sendMessage(from, { text, ...extra }, { quoted: msg });

        if (cmd.owner && !isOwner) {
          await reply('❌ Only the owner can use this command.');
          continue;
        }

        if ((cmd.group || cmd.admin) && !isGroup) {
          await reply('❌ This command works in groups only.');
          continue;
        }

        if (cmd.admin && !isOwner) {
          const meta = await s.groupMetadata(from);
          const isAdmin = meta.participants.some(
            (p) => p.admin && [p.id, p.lid, p.phoneNumber].includes(sender)
          );
          if (!isAdmin) {
            await reply('❌ Only group admins can use this command.');
            continue;
          }
        }

        try {
          await cmd.run({
            sock: s,
            sessionId: id,
            msg,
            from,
            sender,
            args,
            commands,
            config: sessionConfig,
            isOwner,
            isGroup,
            text: args.join(' '),
            reply,
          });
        } catch (err) {
          console.error(`[${id}] command ${cmd.name} failed:`, err);
          const m = String(err?.message || '');
          await reply(
            /not-authorized|forbidden|admin/i.test(m)
              ? '❌ I need to be a group admin to do that.'
              : '❌ Something went wrong running that command.'
          ).catch(() => {});
        }
      } catch (err) {
        console.error(`[${id}] error handling message:`, err);
      }
    }
  }));

  return sess;
}

// Fresh socket so a new pairing code gets its full lifetime
async function freshSession(id) {
  const existing = sessions.get(id);
  if (existing?.timer) {
    clearTimeout(existing.timer);
    existing.timer = null;
  }
  const old = existing?.sock;
  const p = startSession(id);
  try {
    old?.end(undefined);
  } catch {}
  return p;
}

// ---------- Web server (pair page) ----------
const app = express();
app.set('trust proxy', 1); // Heroku/Render sit behind a proxy; this makes req.ip the real visitor
const PAIR_KEY = process.env.PAIR_KEY;
let pairBusy = false;

// Very small brute-force guard: 5 wrong keys per IP per 15 minutes
const fails = new Map();
function tooManyFails(ip) {
  const f = fails.get(ip);
  return f && Date.now() - f.t < 15 * 60 * 1000 && f.n >= 5;
}
function recordFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.t >= 15 * 60 * 1000) fails.set(ip, { n: 1, t: Date.now() });
  else f.n++;
}

const page = (body) => renderPage(config.botName, body);

app.get('/', (req, res) => {
  const total = sessions.size;
  const online = [...sessions.values()].filter((s) => s.isOnline).length;
  res.send(page(homeBody({ online, total })));
});

// Checks shared by "Get Pair Code" and "Scan QR Code".
// Returns the number, or null after sending an error page.
function checkRequest(req, res) {
  const ip = req.ip;

  if (tooManyFails(ip)) {
    res.status(429).send(page(notice('Too many wrong keys. Try again later.', false)));
    return null;
  }
  if (!PAIR_KEY || req.body?.key !== PAIR_KEY) {
    recordFail(ip);
    res.status(403).send(page(notice('❌ Wrong pair key.')));
    return null;
  }

  const number = String(req.body.number || '').replace(/\D/g, '');
  if (!number) {
    res.status(400).send(page(notice('Enter your number with country code.')));
    return null;
  }

  if (pairBusy) {
    res.status(429).send(page(notice('Another request is in progress. Wait a few seconds.')));
    return null;
  }

  return number;
}

// Starts a fresh socket for the number and waits until it is ready to link.
// Returns the session, or null after sending a page.
async function beginLink(res, number, viaQr) {
  const existing = sessions.get(number);

  if (existing?.isOnline) {
    res.send(page(notice('✅ That number is already linked and online.')));
    return null;
  }
  if (existing?.sock?.authState?.creds?.registered) {
    res.send(page(notice('That number is already linked and is reconnecting. Give it a moment.')));
    return null;
  }
  if (!existing && sessions.size >= MAX_SESSIONS) {
    res.status(400).send(page(notice(`Limit of ${MAX_SESSIONS} numbers reached.`)));
    return null;
  }

  const sess = await freshSession(number);
  sess.viaQr = viaQr;

  for (let i = 0; i < 40 && !sess.canPair; i++) await sleep(500);

  if (!sess.canPair) {
    res.status(503).send(page(notice('Not ready yet. Wait 10 seconds and try again.')));
    return null;
  }

  sess.token = crypto.randomBytes(16).toString('hex'); // lets this page ask for status
  return sess;
}

app.post('/pair', express.urlencoded({ extended: false }), async (req, res) => {
  const number = checkRequest(req, res);
  if (!number) return;

  pairBusy = true;
  try {
    const sess = await beginLink(res, number, false);
    if (!sess) return;

    const code = await sess.sock.requestPairingCode(number);
    const pretty = code.match(/.{1,4}/g)?.join('-') || code;

    res.send(page(pairBody({ code: pretty, number, token: sess.token })));
  } catch (err) {
    console.error('Pair error:', err);
    if (!res.headersSent) {
      res.status(500).send(page(notice(`Could not get a code: ${esc(err.message)}`)));
    }
  } finally {
    pairBusy = false;
  }
});

app.post('/qr', express.urlencoded({ extended: false }), async (req, res) => {
  const number = checkRequest(req, res);
  if (!number) return;

  pairBusy = true;
  try {
    const sess = await beginLink(res, number, true);
    if (!sess) return;

    res.send(page(qrBody({ number, token: sess.token })));
  } catch (err) {
    console.error('QR error:', err);
    if (!res.headersSent) {
      res.status(500).send(page(notice(`Could not start: ${esc(err.message)}`)));
    }
  } finally {
    pairBusy = false;
  }
});

// The pair/QR page asks this every few seconds (needs the token it was given)
app.get('/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const number = String(req.query.number || '').replace(/\D/g, '');
  const sess = sessions.get(number);

  if (!sess || !sess.token || req.query.token !== sess.token) {
    return res.json({ state: 'ended' });
  }
  if (sess.isOnline) return res.json({ state: 'online' });
  res.json({ state: 'waiting', qr: sess.viaQr ? sess.qr || null : null });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Web server on port ${PORT}`));

// ---------- Boot: reconnect every saved number ----------
const saved = await listSavedSessions();
console.log(`Found ${saved.length} saved session(s): ${saved.join(', ') || 'none'}`);

for (const id of saved) {
  startSession(id).catch((err) => {
    console.error(`[${id}] start failed, retrying in 5s:`, err.message);
    scheduleReconnect(sessions.get(id) || { id, timer: null }, 5000);
  });
  await sleep(1000); // stagger so many sockets don't all connect at once
}
