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
import { loadSettings, getSettings, updateSettings, allowed, matchPrefix, runWithSession } from './lib/settings.js';
import { onConnected, onDisconnected, resetWelcome } from './lib/welcome.js';
import { attachFeatures } from './lib/features.js';
import { useSupabaseAuthState } from './lib/supabaseAuth.js';
import { followChannel } from './lib/channel.js';
import { page as renderPage, notice, homeBody, pairBody, qrBody, restoreBody } from './lib/portal.js';
import { credsToCode, decodeCode, seedCreds } from './lib/restore.js';
import { loginPage, dashboardPage } from './lib/admin.js';
import { protectSocket, commandGate } from './lib/antiban.js';

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

// Short, readable session ID for each linked number, like K7M2-Q9XA-4TBH.
// Letters that look alike (0/O, 1/I) are left out.
// IMPORTANT: this ID is a RESTORE KEY. Whoever has it can move the linked device
// to another bot (see /restore below), so treat it like a password.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeSessionCode() {
  for (;;) {
    let c = '';
    for (const b of crypto.randomBytes(12)) c += CODE_CHARS[b % CODE_CHARS.length];
    const code = `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
    const taken = [...sessions.keys()].some((k) => getSettings(k).sessionCode === code);
    if (!taken) return code;
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
  // Wait longer after each failed try (3s, 6s, 12s ... up to 5 min).
  // Reconnecting in a tight loop looks robotic to WhatsApp.
  const wait = Math.min(delay * 2 ** (sess.retries || 0), 5 * 60 * 1000);
  sess.retries = (sess.retries || 0) + 1;
  sess.timer = setTimeout(() => {
    sess.timer = null;
    startSession(sess.id).catch((err) => {
      console.error(`[${sess.id}] start failed, retrying in 5s:`, err.message);
      scheduleReconnect(sess, 5000);
    });
  }, wait);
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
  // Every message this number sends now goes through the throttle (delays, limits)
  protectSocket(s, id, { isGhost: () => !!getSettings(id).ghost });
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

      // Give this number a short session ID the first time it connects
      const haveCode = getSettings(id).sessionCode;
      if (!haveCode || haveCode.length < 14) {
        await updateSettings({ sessionCode: makeSessionCode() }, id);
      }

      // Give it a portable session code too, and send it ONCE, privately, in
      // its own WhatsApp chat. This code is as sensitive as a password.
      if (!getSettings(id).restoreCodeSent) {
        try {
          const restoreCode = credsToCode(baileys, state.creds);
          await updateSettings({ restoreCodeSent: true }, id);
          await s.sendMessage(baileys.jidNormalizedUser(s.user.id), {
            text:
              '🔐 *Session code* (keep this private, do not share it)\n\n' +
              'Anyone who has this code can control this WhatsApp number through the bot. ' +
              'Save it somewhere safe. Use it to restore this session on another deployment, ' +
              'without scanning or pairing again.\n\n' +
              restoreCode,
          });
        } catch (e) {
          console.error(`[${id}] could not send session code:`, e.message);
        }
      }

      sess.isOnline = true;
      sess.onlineSince = Date.now();
      sess.retries = 0; // connected fine, so reset the reconnect delay
      sess.canPair = false;
      console.log(`✅ [${id}] ${config.botName} is online!`);
      onConnected(s, config, id).catch((e) =>
        console.error(`[${id}] welcome error:`, e?.message || e)
      );

      followChannel(s, id).catch(() => {});
    }

    if (connection === 'close') {
      sess.isOnline = false;
      sess.onlineSince = null;
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
        await updateSettings({ sessionCode: null }, id); // the ID stops working
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
        if (!msg.message) {
          // Messages that could not be opened (for example some view once ones) arrive empty
          if (msg.messageStubType) {
            console.log(`[${id}] [msg] empty message from ${msg.key.remoteJid} (stub type ${msg.messageStubType}, ${type})`);
          }
          continue;
        }

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
        } else {
          // No text (photo, video, view once...): show what kind of message it is
          console.log(`[${id}] [msg] ${msg.key.fromMe ? 'me' : 'them'} ${from}: <${Object.keys(msg.message).join(', ')}>`);
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

        // Ignore command spam, so the bot can't be pushed into a reply flood
        if (!commandGate({ sessionId: id, chat: from, sender, isOwner })) continue;

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
const PAIR_KEY = process.env.PAIR_KEY || '123'; // shown on the pairing page, so treat it as public
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
  res.send(page(homeBody({ online, total, pairKey: PAIR_KEY })));
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
app.post('/restore', express.urlencoded({ extended: false }), async (req, res) => {
  const ip = req.ip;

  if (tooManyFails(ip)) {
    return res.status(429).send(page(notice('Too many wrong keys. Try again later.', false)));
  }
  if (!PAIR_KEY || req.body?.key !== PAIR_KEY) {
    recordFail(ip);
    return res.status(403).send(page(notice('❌ Wrong pair key.')));
  }
  if (pairBusy) {
    return res.status(429).send(page(notice('Another request is in progress. Wait a few seconds.')));
  }

  pairBusy = true;
  try {
    let id, json;
    try {
      ({ id, json } = decodeCode(baileys, req.body.code));
    } catch (err) {
      return res.status(400).send(page(notice(`❌ ${esc(err.message)}`)));
    }

    const existing = sessions.get(id);
    if (existing?.isOnline) {
      return res.send(page(notice('✅ That number is already linked and online.')));
    }
    if (!existing && sessions.size >= MAX_SESSIONS) {
      return res.status(400).send(page(notice(`Limit of ${MAX_SESSIONS} numbers reached.`)));
    }

    await seedCreds(id, json, config.sessionDir);

    const sess = await freshSession(id);
    sess.token = crypto.randomBytes(16).toString('hex');

    // Registered creds reconnect on their own, with no code or QR needed.
    // Wait to see whether WhatsApp accepts it or rejects it (bad/expired code).
    for (let i = 0; i < 30 && !sess.isOnline && sess.gen === sessions.get(id)?.gen; i++) {
      await sleep(500);
    }

    if (!sessions.has(id)) {
      // Removed itself already: WhatsApp rejected the credentials (e.g. logged out elsewhere)
      return res.status(400).send(
        page(notice('❌ That code did not work. It may be expired, already in use elsewhere, or revoked.'))
      );
    }

    res.send(page(restoreBody({ number: id, token: sess.token, online: sess.isOnline })));
  } catch (err) {
    console.error('Restore error:', err);
    if (!res.headersSent) {
      res.status(500).send(page(notice(`Could not restore: ${esc(err.message)}`)));
    }
  } finally {
    pairBusy = false;
  }
});

app.get('/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const number = String(req.query.number || '').replace(/\D/g, '');
  const sess = sessions.get(number);

  if (!sess || !sess.token || req.query.token !== sess.token) {
    return res.json({ state: 'ended' });
  }
  if (sess.isOnline) {
    return res.json({ state: 'online', code: getSettings(sess.id).sessionCode || null });
  }
  res.json({ state: 'waiting', qr: sess.viaQr ? sess.qr || null : null });
});

// ---------- Admin dashboard (/admin) ----------
// Protected by its own ADMIN_KEY. The pair key is public, so it is never used here.
const ADMIN_KEY = process.env.ADMIN_KEY;
const adminToken = ADMIN_KEY
  ? crypto.createHmac('sha256', ADMIN_KEY).update('admin-session').digest('hex')
  : null;

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function cookieOf(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const isAdmin = (req) => {
  const c = cookieOf(req, 'admin');
  return !!(adminToken && c && safeEqual(c, adminToken));
};

async function loadUsers() {
  if (!supabase) return { enabled: false, total: 0, recent: [] };
  const { data, count, error } = await supabase
    .from('users')
    .select('jid,name,last_seen', { count: 'exact' })
    .order('last_seen', { ascending: false })
    .limit(50);
  if (error) return { enabled: true, error: error.message, total: 0, recent: [] };
  return { enabled: true, total: count ?? data.length, recent: data };
}

app.get('/admin', (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(503).send(loginPage(config.botName, 'Set ADMIN_KEY in your settings to turn on the dashboard.'));
  }
  res.send(isAdmin(req) ? dashboardPage(config.botName) : loginPage(config.botName));
});

app.post('/admin/login', express.urlencoded({ extended: false }), (req, res) => {
  if (!ADMIN_KEY) return res.status(503).send(loginPage(config.botName, 'Dashboard is not set up.'));
  if (tooManyFails(req.ip)) {
    return res.status(429).send(loginPage(config.botName, 'Too many wrong keys. Try again later.'));
  }
  if (!safeEqual(req.body?.key ?? '', ADMIN_KEY)) {
    recordFail(req.ip);
    return res.status(403).send(loginPage(config.botName, 'Wrong key.'));
  }
  res.setHeader(
    'Set-Cookie',
    `admin=${adminToken}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=604800${req.secure ? '; Secure' : ''}`
  );
  res.redirect(303, '/admin');
});

app.post('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0');
  res.redirect(303, '/admin');
});

app.get('/admin/data', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'login required' });

  const list = [...sessions.values()]
    .map((s) => ({
      id: s.id,
      name: s.sock?.user?.name || null,
      online: !!s.isOnline,
      linked: !!s.sock?.authState?.creds?.registered,
      since: s.onlineSince || null,
      code: getSettings(s.id).sessionCode || null,
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.id.localeCompare(b.id));

  res.json({ now: Date.now(), sessions: list, users: await loadUsers() });
});

// Unlinks a number and removes it from the bot completely
async function removeSession(sess) {
  if (sess.timer) {
    clearTimeout(sess.timer);
    sess.timer = null;
  }
  sess.gen++; // anything the old socket still reports is ignored from now on
  const wasOnline = sess.isOnline;
  sess.isOnline = false;
  sess.onlineSince = null;
  sess.qr = null;
  onDisconnected(sess.id); // stops the "still online" timer

  // Ask WhatsApp to unlink the device (only possible while connected)
  if (wasOnline) await sess.sock?.logout().catch(() => {});
  try {
    sess.sock?.end(undefined);
  } catch {}

  await wipeAuth(sess);
  await Promise.resolve(resetWelcome(sess.id)).catch(() => {});
  await updateSettings({ sessionCode: null }, sess.id); // the ID stops working
  sessions.delete(sess.id);
}

app.post('/admin/disconnect', express.json({ limit: '1kb' }), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'login required' });

  const sess = sessions.get(String(req.body?.id || ''));
  if (!sess) return res.status(404).json({ error: 'That number is not linked any more.' });

  try {
    await removeSession(sess);
    console.log(`[${sess.id}] disconnected from the admin dashboard.`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[${sess.id}] disconnect failed:`, err);
    res.status(500).json({ error: 'Could not disconnect that number.' });
  }
});

// ---------- Move a session to another bot: GET /restore/<session ID> ----------
// The session ID is a password: whoever has it can take over the linked device.
// Using it MOVES the session. This bot lets go of the number, so WhatsApp never
// sees the same login running in two places at once.

// Stops a number here WITHOUT unlinking it from WhatsApp
async function releaseSession(sess) {
  if (sess.timer) {
    clearTimeout(sess.timer);
    sess.timer = null;
  }
  sess.gen++;
  sess.isOnline = false;
  sess.onlineSince = null;
  sess.qr = null;
  onDisconnected(sess.id);
  try {
    sess.sock?.end(undefined);
  } catch {}
  await wipeAuth(sess); // removes the saved login from here, but does not log out
  await updateSettings({ sessionCode: null }, sess.id);
  sessions.delete(sess.id);
}

app.get('/restore/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (tooManyFails(req.ip)) {
    return res.status(429).json({ error: 'Too many tries. Try again later.' });
  }

  const wanted = String(req.params.id || '').trim().toUpperCase();
  const sess =
    wanted.length >= 14
      ? [...sessions.values()].find((s) => getSettings(s.id).sessionCode === wanted)
      : null;
  const creds = sess?.sock?.authState?.creds;

  if (!sess || !creds?.registered) {
    recordFail(req.ip);
    return res.status(404).json({ error: 'Unknown or already used session ID.' });
  }

  // Lets the other bot check the number first, before anything is moved
  if (req.query.info === '1') return res.json({ ok: true, number: sess.id });

  if (req.query.move !== '1') {
    return res
      .status(400)
      .json({ error: 'Restoring moves the session away from this bot. Add ?move=1 to confirm.' });
  }

  res.type('application/json').send(JSON.stringify(creds, baileys.BufferJSON.replacer));
  res.once('finish', () => {
    releaseSession(sess)
      .then(() => console.log(`[${sess.id}] moved to another bot (session ID used).`))
      .catch((err) => console.error(`[${sess.id}] release failed:`, err));
  });
});

// Brings a session in from another bot. Set SESSION_URL (that bot's web address)
// and SESSION_ID (the ID it gave you). It moves here once, on first start.
async function importSession(baseUrl, sessionId) {
  const root = baseUrl.trim().replace(/\/+$/, '');
  const id = encodeURIComponent(sessionId.trim());
  try {
    const info = await fetch(`${root}/restore/${id}?info=1`);
    if (info.status === 404) {
      console.log('[restore] session ID not found: it was already used, or it is wrong.');
      return;
    }
    if (!info.ok) {
      console.error('[restore] could not reach the other bot:', info.status);
      return;
    }
    const { number } = await info.json();

    if ((await listSavedSessions()).includes(number)) {
      console.log(`[restore] ${number} is already here, nothing to do.`);
      return;
    }

    const res = await fetch(`${root}/restore/${id}?move=1`);
    if (!res.ok) {
      console.error('[restore] move failed:', res.status);
      return;
    }
    const text = await res.text();
    JSON.parse(text, baileys.BufferJSON.reviver); // must be valid before it is saved

    if (supabase) {
      const { error } = await supabase
        .from('auth_state')
        .upsert({ id: `${number}:creds`, data: text }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    } else {
      const dir = path.join(config.sessionDir, number);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, 'creds.json'), text);
    }
    console.log(`[restore] ${number} restored here.`);
  } catch (err) {
    console.error('[restore] failed (if the session was already moved, the number must be paired again):', err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Web server on port ${PORT}`));

// ---------- Boot: reconnect every saved number ----------
if (process.env.SESSION_ID && process.env.SESSION_URL) {
  await importSession(process.env.SESSION_URL, process.env.SESSION_ID);
}

const saved = await listSavedSessions();
console.log(`Found ${saved.length} saved session(s): ${saved.join(', ') || 'none'}`);

for (const id of saved) {
  startSession(id).catch((err) => {
    console.error(`[${id}] start failed, retrying in 5s:`, err.message);
    scheduleReconnect(sessions.get(id) || { id, timer: null }, 5000);
  });
  await sleep(1000); // stagger so many sockets don't all connect at once
}
