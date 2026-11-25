import { supabase } from './db.js';

const TABLE = 'auth_state';

// In-memory copy of the session. Reads and writes hit memory first, and
// changes are saved to Supabase in the background in batches. This keeps
// pairing fast, because WhatsApp times out if saving is slow.
const cache = new Map(); // rowId -> JSON string, or null if deleted
const pending = new Map(); // rowId -> JSON string to save, or null to delete
let flushTimer = null;
let flushing = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function scheduleFlush(ms = 300) {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, ms);
}

async function flush() {
  flushTimer = null;
  if (flushing) return scheduleFlush();
  if (!pending.size) return;
  flushing = true;

  const batch = [...pending.entries()];
  pending.clear();
  const upserts = batch.filter(([, v]) => v !== null).map(([id, data]) => ({ id, data }));
  const deletes = batch.filter(([, v]) => v === null).map(([id]) => id);
  const requeue = (id, v) => {
    if (!pending.has(id)) pending.set(id, v);
  };
  let failed = false;

  try {
    for (let i = 0; i < upserts.length; i += 100) {
      const chunk = upserts.slice(i, i + 100);
      const { error } = await supabase.from(TABLE).upsert(chunk, { onConflict: 'id' });
      if (error) {
        failed = true;
        console.error('[auth] save error:', error.message);
        chunk.forEach((r) => requeue(r.id, r.data));
      }
    }
    for (let i = 0; i < deletes.length; i += 100) {
      const chunk = deletes.slice(i, i + 100);
      const { error } = await supabase.from(TABLE).delete().in('id', chunk);
      if (error) {
        failed = true;
        console.error('[auth] delete error:', error.message);
        chunk.forEach((id) => requeue(id, null));
      }
    }
  } catch (err) {
    failed = true;
    console.error('[auth] flush failed:', err.message);
    upserts.forEach((r) => requeue(r.id, r.data));
    deletes.forEach((id) => requeue(id, null));
  }

  flushing = false;
  if (pending.size) scheduleFlush(failed ? 3000 : 300);
}

export async function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (flushing) await sleep(50);
  await flush();
}

// Save pending changes before Render stops or redeploys the service
process.once('SIGTERM', async () => {
  try {
    await flushNow();
  } finally {
    process.exit(0);
  }
});

export async function useSupabaseAuthState(baileys, sessionId = 'main') {
  const { initAuthCreds, BufferJSON, proto } = baileys;
  const rowId = (key) => `${sessionId}:${key}`;
  const parse = (json) => (json ? JSON.parse(json, BufferJSON.reviver) : null);
  const stringify = (value) => JSON.stringify(value, BufferJSON.replacer);

  const readMany = async (keys, strict = false) => {
    const out = {};
    const missing = [];
    for (const key of keys) {
      const id = rowId(key);
      if (cache.has(id)) out[key] = cache.get(id);
      else missing.push(key);
    }
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const { data, error } = await supabase
        .from(TABLE)
        .select('id,data')
        .in('id', chunk.map(rowId));
      if (error) {
        console.error('[auth] read error:', error.message);
        if (strict) throw new Error(`Could not read session: ${error.message}`);
        continue;
      }
      const found = new Map((data || []).map((r) => [r.id, r.data]));
      for (const key of chunk) {
        const id = rowId(key);
        const json = found.has(id) ? found.get(id) : null;
        cache.set(id, json);
        out[key] = json;
      }
    }
    return out;
  };

  const queue = (id, json) => {
    cache.set(id, json);
    pending.set(id, json);
  };

  // strict: if the database can't be read, stop instead of creating a new empty session
  const stored = await readMany(['creds'], true);
  const creds = parse(stored.creds) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const rows = await readMany(ids.map((id) => `${type}-${id}`));
          const out = {};
          for (const id of ids) {
            let value = parse(rows[`${type}-${id}`]);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            out[id] = value;
          }
          return out;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              queue(rowId(`${category}-${id}`), value ? stringify(value) : null);
            }
          }
          scheduleFlush();
        },
      },
    },
    saveCreds: async () => {
      queue(rowId('creds'), stringify(creds));
      scheduleFlush();
    },
    clear: async () => {
      const prefix = `${sessionId}:`;
      for (const id of [...cache.keys()]) if (id.startsWith(prefix)) cache.delete(id);
      for (const id of [...pending.keys()]) if (id.startsWith(prefix)) pending.delete(id);
      while (flushing) await sleep(50);
      const { error } = await supabase.from(TABLE).delete().like('id', `${prefix}%`);
      if (error) console.error('[auth] clear error:', error.message);
    },
  };
}
