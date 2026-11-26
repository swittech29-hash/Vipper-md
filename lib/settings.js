import { AsyncLocalStorage } from 'async_hooks';
import { supabase } from './db.js';

// Settings are now kept per linked number, in the same Supabase table as the
// WhatsApp session. Your existing settings live on as the "main" session.
const TABLE = 'auth_state';
const rowId = (id) => `settings:${id}`;

const defaults = {
  mode: 'public',
  prefix: null,
  sleeping: false,
  autoread: false,
  autotyping: false,
  autorecording: false,
  autoreact: false,
  autostatus: false,
  autosavestatus: false,
  autolikestatus: false,
  statusEmoji: '❤️',
  ghost: false,
  welcomed: false,
  lastOnlineAt: null,
  antidelete: false,
  antiedit: false,
};

const all = new Map(); // sessionId -> settings object
const als = new AsyncLocalStorage();

// While a message is being handled, getSettings() / updateSettings() with no
// id automatically use the number that received the message. This keeps your
// existing commands working without any changes.
export const runWithSession = (id, fn) => als.run(id, fn);
const keyFor = (id) => id || als.getStore() || 'main';

export function getSettings(id) {
  const key = keyFor(id);
  if (!all.has(key)) all.set(key, { ...defaults });
  return all.get(key);
}

export async function loadSettings(config, id) {
  const key = keyFor(id);
  let loaded = { ...defaults };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('data')
        .eq('id', rowId(key))
        .maybeSingle();
      if (error) console.error(`[settings:${key}] load error:`, error.message);
      else if (data?.data) loaded = { ...defaults, ...JSON.parse(data.data) };
    } catch (err) {
      console.error(`[settings:${key}] load failed:`, err.message);
    }
  }

  all.set(key, loaded);
  console.log(
    `[settings:${key}] mode=${loaded.mode} prefix="${loaded.prefix || config.prefix}" sleeping=${loaded.sleeping}`
  );
}

export async function updateSettings(patch, id) {
  const key = keyFor(id);
  const next = { ...getSettings(key), ...patch };
  all.set(key, next);

  if (!supabase) return;
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ id: rowId(key), data: JSON.stringify(next) }, { onConflict: 'id' });
    if (error) console.error(`[settings:${key}] save error:`, error.message);
  } catch (err) {
    console.error(`[settings:${key}] save failed:`, err.message);
  }
}

// Should this message's command be handled right now?
export function allowed(cmdName, isOwner, id) {
  const s = getSettings(id);
  if (s.sleeping && !(isOwner && cmdName === 'sleepbot')) return false;
  if (s.mode === 'private' && !isOwner) return false;
  return true;
}

// Which prefix did the message start with? The owner can always use "!prefix"
// to fix things if they forget a custom prefix.
export function matchPrefix(body, isOwner, prefix) {
  if (body.startsWith(prefix)) return prefix;
  if (isOwner && /^!prefix(\s|$)/i.test(body)) return '!';
  return null;
}
