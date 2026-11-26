import { supabase } from './db.js';

// Bot settings are kept in the same Supabase table as the WhatsApp session,
// under their own id, so they survive restarts and redeploys.
const TABLE = 'auth_state';
const ID = 'settings:main';

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
  antidelete: false,
  antiedit: false,
};
let current = { ...defaults };
let cfg = null; // the config object, so a new prefix applies everywhere at once

export const getSettings = () => current;

export async function loadSettings(config) {
  cfg = config;
  if (supabase) {
    try {
      const { data, error } = await supabase.from(TABLE).select('data').eq('id', ID).maybeSingle();
      if (error) console.error('[settings] load error:', error.message);
      else if (data?.data) current = { ...defaults, ...JSON.parse(data.data) };
    } catch (err) {
      console.error('[settings] load failed:', err.message);
    }
  }
  if (current.prefix) cfg.prefix = current.prefix;
  console.log(`[settings] mode=${current.mode} prefix="${cfg.prefix}" sleeping=${current.sleeping}`);
}

export async function updateSettings(patch) {
  current = { ...current, ...patch };
  if (patch.prefix && cfg) cfg.prefix = patch.prefix;
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ id: ID, data: JSON.stringify(current) }, { onConflict: 'id' });
    if (error) console.error('[settings] save error:', error.message);
  } catch (err) {
    console.error('[settings] save failed:', err.message);
  }
}

// Should this message's command be handled right now?
export function allowed(cmdName, isOwner) {
  if (current.sleeping && !(isOwner && cmdName === 'sleepbot')) return false;
  if (current.mode === 'private' && !isOwner) return false;
  return true;
}

// Which prefix did the message start with? The owner can always use "!prefix"
// to fix things if they forget a custom prefix.
export function matchPrefix(body, isOwner, prefix) {
  if (body.startsWith(prefix)) return prefix;
  if (isOwner && /^!prefix(\s|$)/i.test(body)) return '!';
  return null;
}
