// A throwaway local Postgres that looks enough like Supabase to run the
// migration: the anon, authenticated, and service_role roles, and RPCs called
// as anon with PostgREST's request.headers setting. Never points at the live
// project.
//
//   BOOKCLUB_PG=postgres://postgres:postgres@127.0.0.1:5432  (the default)
import fs from "node:fs";
import http from "node:http";
import pg from "pg";

const root = new URL("..", import.meta.url).pathname;
export const MIGRATION = `${root}supabase/migrations/20261022230000_bookclub.sql`;
const ADMIN = process.env.BOOKCLUB_PG || "postgres://postgres:postgres@127.0.0.1:5432";
const DB = process.env.BOOKCLUB_DB || "bookclub_test";

if (/supabase\.co|pooler\.supabase/.test(ADMIN)) {
  throw new Error("tools/local-db.mjs only runs against a local Postgres");
}

export async function freshDatabase({ applyTimes = 1 } = {}) {
  const admin = new pg.Client({ connectionString: `${ADMIN}/postgres` });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  for (const role of ["anon", "authenticated", "service_role"]) {
    await admin.query(`do $$ begin create role ${role} nologin; exception when duplicate_object then null; end $$`);
  }
  await admin.end();

  const pool = new pg.Pool({ connectionString: `${ADMIN}/${DB}`, max: 12 });
  // Supabase's default: anon can use the public schema and execute new functions.
  await pool.query("grant usage on schema public to anon, authenticated, service_role");
  const sql = fs.readFileSync(MIGRATION, "utf8");
  for (let i = 0; i < applyTimes; i += 1) await pool.query(sql);
  return pool;
}

// Call public.<fn>(named args) the way PostgREST does: as anon, in its own
// transaction, with the client address in request.headers.
export async function rpc(pool, fn, args = {}, { ip = "203.0.113.7" } = {}) {
  if (!/^bookclub_[a-z_]+$/.test(fn)) throw new Error(`not an RPC: ${fn}`);
  const keys = Object.keys(args);
  for (const key of keys) if (!/^p_[a-z_]+$/.test(key)) throw new Error(`bad arg ${key}`);
  const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as data`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-forwarded-for": ip })]);
    await client.query("set local role anon");
    const { rows } = await client.query(call, keys.map((k) => args[k]));
    await client.query("commit");
    return rows[0].data;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Superuser access for tests that need to move the clock (e.g. end the hour).
export async function sql(pool, text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// A tiny stand-in for the Supabase REST endpoint: POST /rest/v1/rpc/<fn>.
// Browser tests route the app's RPC calls here.
export function serveRpc(pool, port = 54329) {
  const server = http.createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const match = req.url.match(/\/rest\/v1\/rpc\/([a-z_]+)/);
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const data = await rpc(pool, match?.[1] || "", body ? JSON.parse(body) : {});
      res.writeHead(200, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ message: error.message, code: error.code }));
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
