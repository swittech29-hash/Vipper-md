// Makes the bot send the way a person would, to lower the chance WhatsApp
// flags a linked number. It does three things:
//   1. Every outgoing message waits its turn, with a random gap between them.
//   2. Each number has per-minute / per-hour / per-day sending limits.
//   3. People can't spam commands (per-user cooldown, per-chat limit).
// Nothing can make a ban impossible, but this removes the biggest triggers:
// fast bursts, mass sending, and robotic timing.

const num = (v, d) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

// All of these can be changed from your host's environment settings.
const CFG = {
  gapMin: num(process.env.SEND_MIN_GAP_MS, 1200), // fastest gap between two messages
  gapMax: num(process.env.SEND_MAX_GAP_MS, 2600),
  bulkMin: num(process.env.SEND_BULK_MIN_MS, 4000), // gap once it looks like a mass send
  bulkMax: num(process.env.SEND_BULK_MAX_MS, 9000),
  perMinute: num(process.env.SEND_PER_MINUTE, 20), // waits when this is reached
  perHour: num(process.env.SEND_PER_HOUR, 300), // refuses when this is reached
  perDay: num(process.env.SEND_PER_DAY, 1500),
  maxQueue: num(process.env.SEND_MAX_QUEUE, 150),
  typing: process.env.SEND_TYPING !== 'off', // show "typing..." before replies
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
const userPart = (j) => String(j || '').split('@')[0].split(':')[0];

export function protectSocket(sock, sessionId, { isGhost = () => false } = {}) {
  const original = sock.sendMessage.bind(sock);
  const st = { chain: Promise.resolve(), queued: 0, sends: [], last: 0 }; // sends: { t, jid }

  // Messages to your own chat (results, errors, welcome) are never limited
  const isSelf = (jid) => !!sock.user?.id && userPart(jid) === userPart(sock.user.id);

  async function waitTurn(jid) {
    const now = Date.now();
    st.sends = st.sends.filter((s) => s.t > now - 86400000);
    const within = (ms) => st.sends.filter((s) => s.t > now - ms);

    if (st.sends.length >= CFG.perDay) {
      throw new Error('Daily sending limit reached for this number. Try again tomorrow.');
    }
    if (within(3600000).length >= CFG.perHour) {
      throw new Error('Hourly sending limit reached for this number. Try again later.');
    }

    const lastMin = within(60000);
    let wait = 0;
    if (lastMin.length >= CFG.perMinute) {
      wait = lastMin[lastMin.length - CFG.perMinute].t + 60000 - now;
    }

    // Mass sending (many different chats) gets much bigger gaps than normal replies
    const distinctChats = new Set(lastMin.map((s) => s.jid)).size;
    const sameChat = lastMin.filter((s) => s.jid === jid).length;
    let lo = CFG.gapMin;
    let hi = CFG.gapMax;
    if (distinctChats >= 5) {
      lo = CFG.bulkMin;
      hi = CFG.bulkMax;
    } else if (sameChat >= 10) {
      lo = CFG.gapMax * 1.5;
      hi = CFG.gapMax * 3;
    }

    wait = Math.max(wait, st.last + rand(lo, hi) - now);
    if (wait > 0) await sleep(wait);
  }

  // Show "typing..." for a moment before a text reply, like a person would
  async function humanize(jid, content) {
    if (!CFG.typing || jid === 'status@broadcast' || isGhost()) return;
    const text = content?.text ?? content?.caption;
    if (typeof text !== 'string') return;
    try {
      await sock.sendPresenceUpdate('composing', jid);
      await sleep(Math.min(2500, 400 + text.length * 25) * (0.7 + Math.random() * 0.6));
      await sock.sendPresenceUpdate('paused', jid);
    } catch {
      /* presence is optional */
    }
  }

  async function run(jid, content, options) {
    await waitTurn(jid);
    await humanize(jid, content);
    try {
      return await original(jid, content, options);
    } finally {
      const t = Date.now();
      st.last = t;
      st.sends.push({ t, jid });
    }
  }

  sock.sendMessage = (jid, content, options) => {
    if (isSelf(jid)) return original(jid, content, options);
    if (st.queued >= CFG.maxQueue) {
      return Promise.reject(new Error('Sending too fast. Please slow down and try again.'));
    }
    st.queued++;
    const job = st.chain.then(() => run(jid, content, options));
    st.chain = job.then(() => {}, () => {}); // one failure never blocks the queue
    return job.finally(() => {
      st.queued--;
    });
  };
}

// ---------- Command cooldowns ----------
const lastUse = new Map(); // session:chat:sender -> time of last command
const chatHits = new Map(); // session:chat -> times of recent commands

setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [k, t] of lastUse) if (t < cutoff) lastUse.delete(k);
  for (const [k, list] of chatHits) {
    const keep = list.filter((t) => t > cutoff);
    if (keep.length) chatHits.set(k, keep);
    else chatHits.delete(k);
  }
}, 300000).unref();

// Returns false when a command should be quietly ignored.
// Normal users: one command per 3 seconds, and at most 12 a minute per chat.
// The owner gets a much lighter limit.
export function commandGate({ sessionId, chat, sender, isOwner }) {
  const now = Date.now();
  const userKey = `${sessionId}:${chat}:${sender}`;
  const chatKey = `${sessionId}:${chat}`;

  if (now - (lastUse.get(userKey) || 0) < (isOwner ? 800 : 3000)) return false;

  if (!isOwner) {
    const recent = (chatHits.get(chatKey) || []).filter((t) => t > now - 60000);
    if (recent.length >= 12) return false;
    recent.push(now);
    chatHits.set(chatKey, recent);
  }

  lastUse.set(userKey, now);
  return true;
}
