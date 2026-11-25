import { supabase } from './db.js';

export async function useSupabaseAuthState(baileys, sessionId = 'main') {
  const { initAuthCreds, BufferJSON, proto } = baileys;
  const table = 'auth_state';
  const rowId = (key) => `${sessionId}:${key}`;

  const write = async (key, value) => {
    const { error } = await supabase
      .from(table)
      .upsert({ id: rowId(key), data: JSON.stringify(value, BufferJSON.replacer) }, { onConflict: 'id' });
    if (error) console.error('[auth] write error:', error.message);
  };

  const read = async (key) => {
    const { data, error } = await supabase
      .from(table)
      .select('data')
      .eq('id', rowId(key))
      .maybeSingle();
    if (error || !data) return null;
    return JSON.parse(data.data, BufferJSON.reviver);
  };

  const remove = async (key) => {
    await supabase.from(table).delete().eq('id', rowId(key));
  };

  const creds = (await read('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              out[id] = value;
            })
          );
          return out;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? write(key, value) : remove(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write('creds', creds),
    clear: async () => {
      await supabase.from(table).delete().like('id', `${sessionId}:%`);
    },
  };
                }
