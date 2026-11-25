
import { supabase } from './db.js';

const TABLE = 'auth_state';
const ID = 'settings:main';

const defaults = { mode: 'public', prefix: null, sleeping: false };
let current = { ...defaults };
let cfg = null;

export const getSettings = () => current;

export async function loadSettings(config) {
  cfg = config;
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE).select('data').eq('id', ID).maybeSingle();
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

export function allowed(cmdName, isOwner) {
  if (current.sleeping && !(isOwner && cmdName === 'sleepbot')) return false;
  if (current.mode === 'private' && !isOwner) return false;
  return true;
}

export function matchPrefix(body, isOwner, prefix) {
  if (body.startsWith(prefix)) return prefix;
  if (isOwner && /^!prefix(\s|$)/i.test(body)) return '!';
  return null;
}
