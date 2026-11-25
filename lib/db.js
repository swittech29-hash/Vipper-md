import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_KEY } = process.env;

export const supabase =
  SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (!supabase) {
  console.warn('[db] Supabase not configured - running without a database.');
}

export async function saveUser(jid, name) {
  if (!supabase || !jid) return;
  try {
    const { error } = await supabase
      .from('users')
      .upsert({ jid, name, last_seen: new Date().toISOString() }, { onConflict: 'jid' });
    if (error) console.error('[db] saveUser error:', error.message);
  } catch (err) {
    console.error('[db] saveUser failed:', err.message);
  }
}
