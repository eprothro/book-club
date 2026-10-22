import { CLUB } from "./config.js";

const SUPABASE_ESM = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

let clientPromise;

function client() {
  if (!clientPromise) {
    clientPromise = import(SUPABASE_ESM)
      .then(({ createClient }) =>
        createClient(CLUB.supabaseUrl, CLUB.supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        }),
      )
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

// Start fetching the client before the first call needs it.
export function warm() {
  client().catch(() => {});
}

export async function rpc(fn, args = {}) {
  const supabase = await client();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const err = new Error("request failed");
    err.cause = error;
    throw err;
  }
  return data;
}
