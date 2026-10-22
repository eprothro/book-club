// The migration against a local Postgres, as anon: access rules, the round
// lifecycle, the one-time draw, and races. Never touches the live project.
//
//   sudo service postgresql start
//   npm install && node tools/db.mjs
import assert from "node:assert/strict";
import { freshDatabase, rpc, sql } from "./local-db.mjs";

// Applied twice: the file has to be safe to re-run.
const pool = await freshDatabase({ applyTimes: 2 });
const ok = (label) => console.log("ok", label);

// Move the clock past a round's deadline by shifting every round back, so
// "latest round" stays the latest.
async function expire(id, { by = "1 second" } = {}) {
  await sql(pool, `
    with d as (select closes_at - now() + $2::interval as shift from public.bookclub_rounds where id = $1)
    update public.bookclub_rounds
      set opened_at = opened_at - d.shift,
          closes_at = closes_at - d.shift,
          closed_at = closed_at - d.shift
    from d`, [id, by]);
}
async function expireOpen() {
  const rows = await sql(pool, "select id from public.bookclub_rounds where closed_at is null");
  for (const row of rows) await expire(row.id);
}

async function denied(text, label) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role anon");
    await assert.rejects(client.query(text), /permission denied/, label);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

const book = (n, extra = {}) => ({
  p_title: `Book ${n}`,
  p_author: `Author ${n}`,
  p_cover_url: `https://covers.openlibrary.org/b/id/${1000 + n}-M.jpg`,
  p_source_key: `/works/OL${n}W`,
  ...extra,
});

// --- Access ---------------------------------------------------------------
await denied("select * from public.bookclub_rounds", "anon reads rounds");
await denied("select * from public.bookclub_picks", "anon reads picks");
await denied("insert into public.bookclub_rounds (closes_at) values (now() + interval '1 hour')", "anon writes rounds");
await denied("select * from public.bookclub_rate_limits", "anon reads rate limits");
await denied("select bookclub_private.current_round_id()", "anon calls private helpers");
await denied("select bookclub_private.settle(null)", "anon calls settle");
const rls = await sql(pool, `select relname, relrowsecurity from pg_class where relname like 'bookclub_%' and relkind = 'r' order by 1`);
assert.deepEqual(rls.map((r) => [r.relname, r.relrowsecurity]), [
  ["bookclub_picks", true],
  ["bookclub_rate_limits", true],
  ["bookclub_rounds", true],
]);
const grants = await sql(pool, `
  select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as p
  from information_schema.role_table_grants
  where table_name like 'bookclub_%' and grantee in ('anon', 'authenticated', 'public')
  group by 1, 2`);
assert.deepEqual(grants, [], "no table grants for anon/authenticated");
const defs = await sql(pool, `
  select p.proname, p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'bookclub_%' order by 1`);
assert.deepEqual(defs.map((d) => [d.proname, d.prosecdef]), [
  ["bookclub_get_state", true],
  ["bookclub_start_round", true],
  ["bookclub_submit_pick", true],
]);
const objects = await sql(pool, `
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname not like 'bookclub_%'`);
assert.deepEqual(objects, [], "every public object is prefixed bookclub_");
ok("access: RLS on, no anon table grants, private schema closed, RPCs are security definer");

// --- Empty start ------------------------------------------------------------
let state = await rpc(pool, "bookclub_get_state", { p_token: null });
assert.equal(state.ok, true);
assert.equal(state.round, null);
assert.ok(Math.abs(state.now - Date.now()) < 5000, "server clock in ms");
ok("no round yet");

// --- Start ------------------------------------------------------------------
state = await rpc(pool, "bookclub_start_round", {});
assert.equal(state.started, true);
const round1 = state.round;
assert.equal(round1.status, "open");
assert.equal(round1.capacity, 6);
assert.equal(round1.count, 0);
assert.equal(round1.closes_at - round1.opened_at, 3600 * 1000, "one hour window");
assert.equal(round1.picks, null);
{
  const second = await rpc(pool, "bookclub_start_round", {});
  assert.equal(second.started, false, "Start while open returns the open round");
  assert.equal(second.round.id, round1.id);
}
ok("start opens one hour; a second Start joins it");

// --- Submit, change -----------------------------------------------------------
const a = await rpc(pool, "bookclub_submit_pick", { p_round_id: round1.id, ...book(1) });
assert.equal(a.ok, true);
assert.match(a.token, /^[0-9a-f]{64}$/);
assert.equal(a.round.count, 1);
assert.equal(a.round.mine.title, "Book 1");
assert.equal(a.round.picks, null, "titles hidden while open");
const tokenRows = await sql(pool, "select token_hash from public.bookclub_picks");
assert.notEqual(tokenRows[0].token_hash, a.token, "only the hash is stored");

const changed = await rpc(pool, "bookclub_submit_pick", {
  p_round_id: round1.id,
  p_token: a.token,
  ...book(1, { p_title: "  The   Secret History ", p_author: "Donna Tartt" }),
});
assert.equal(changed.ok, true);
assert.equal(changed.token, a.token);
assert.equal(changed.round.count, 1, "changing a pick does not add one");
assert.equal(changed.round.mine.title, "The Secret History", "whitespace collapsed");

const peek = await rpc(pool, "bookclub_get_state", { p_token: null });
assert.equal(peek.round.mine, null, "another phone does not see it");
assert.equal(peek.round.count, 1);
const mineAgain = await rpc(pool, "bookclub_get_state", { p_token: a.token });
assert.equal(mineAgain.round.mine.author, "Donna Tartt", "reopening restores my pick");
ok("submit issues a token; change keeps one seat; picks stay private while open");

// --- Validation -------------------------------------------------------------
for (const [title, label] of [["", "empty"], ["   ", "blank"], ["x".repeat(201), "too long"], ["a\u0007b", "control char"]]) {
  const bad = await rpc(pool, "bookclub_submit_pick", { p_round_id: round1.id, ...book(9, { p_title: title }) });
  assert.deepEqual([bad.ok, bad.error], [false, "title"], label);
}
const evil = await rpc(pool, "bookclub_submit_pick", {
  p_round_id: round1.id,
  ...book(2, { p_cover_url: "https://evil.example/x.jpg", p_author: "y".repeat(400) }),
});
assert.equal(evil.ok, true);
assert.equal(evil.round.mine.cover_url, null, "unknown cover host dropped");
assert.equal(evil.round.mine.author, null, "oversized author dropped");
const gb = await rpc(pool, "bookclub_submit_pick", {
  p_round_id: round1.id,
  p_token: evil.token,
  ...book(2, { p_cover_url: "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1" }),
});
assert.match(gb.round.mine.cover_url, /^https:\/\/books\.google\.com\//);
assert.equal(gb.round.count, 2);
const quoted = await rpc(pool, "bookclub_submit_pick", {
  p_round_id: round1.id,
  p_token: evil.token,
  ...book(2, { p_cover_url: 'https://covers.openlibrary.org/b/id/1"onerror=alert(1).jpg' }),
});
assert.equal(quoted.round.mine.cover_url, null, "quote in cover url dropped");
const wrongRound = await rpc(pool, "bookclub_submit_pick", { p_round_id: "00000000-0000-4000-8000-000000000000", ...book(3) });
assert.deepEqual([wrongRound.ok, wrongRound.error], [false, "closed"]);
const forged = await rpc(pool, "bookclub_submit_pick", { p_round_id: round1.id, p_token: "not-a-token", ...book(3) });
assert.match(forged.token, /^[0-9a-f]{64}$/, "malformed token replaced");
assert.equal(forged.round.count, 3);
ok("validation: titles, cover hosts, oversized fields, wrong round, malformed token");

// --- Early close at 6 ----------------------------------------------------------
const tokens = [a.token, evil.token, forged.token];
for (const n of [4, 5]) {
  const r = await rpc(pool, "bookclub_submit_pick", { p_round_id: round1.id, ...book(n) });
  tokens.push(r.token);
  assert.equal(r.round.status, "open");
}
const sixth = await rpc(pool, "bookclub_submit_pick", { p_round_id: round1.id, ...book(6) });
tokens.push(sixth.token);
assert.equal(sixth.ok, true);
assert.equal(sixth.round.status, "picked", "sixth pick closes the round");
assert.equal(sixth.round.count, 6);
assert.equal(sixth.round.picks.length, 6);
assert.ok(sixth.round.picks.some((p) => p.id === sixth.round.winner_id), "winner is one of the picks");
assert.ok(Number.isInteger(sixth.round.spin_seed));
assert.ok(sixth.round.closed_at < sixth.round.closes_at, "closed early");
const seventh = await rpc(pool, "bookclub_submit_pick", { p_round_id: round1.id, ...book(7) });
assert.deepEqual([seventh.ok, seventh.error], [false, "closed"]);
const lateChange = await rpc(pool, "bookclub_submit_pick", { p_round_id: round1.id, p_token: a.token, ...book(8) });
assert.deepEqual([lateChange.ok, lateChange.error], [false, "closed"], "no changes after close");

const winners = new Set();
const seeds = new Set();
for (let i = 0; i < 25; i += 1) {
  const view = await rpc(pool, "bookclub_get_state", { p_token: tokens[i % 6] });
  winners.add(view.round.winner_id);
  seeds.add(view.round.spin_seed);
  assert.deepEqual(view.round.picks.map((p) => p.id), sixth.round.picks.map((p) => p.id), "same wheel order for everyone");
}
assert.equal(winners.size, 1, "winner never re-rolled");
assert.equal(seeds.size, 1, "spin never re-rolled");
ok("early close at 6: one winner, drawn once, same for every viewer; 7th and late changes refused");

// --- New round after a pick ----------------------------------------------------------
const next = await rpc(pool, "bookclub_start_round", {});
assert.equal(next.started, true);
assert.notEqual(next.round.id, round1.id);
assert.equal(next.round.mine, null);
const stillMine = await rpc(pool, "bookclub_get_state", { p_token: a.token });
assert.equal(stillMine.round.mine, null, "a new round starts clean for every phone");
const reuse = await rpc(pool, "bookclub_submit_pick", { p_round_id: next.round.id, p_token: a.token, ...book(11) });
assert.equal(reuse.token, a.token, "the same phone token works in the next round");
const old = await sql(pool, "select winner_pick_id from public.bookclub_rounds where id = $1", [round1.id]);
assert.equal(old[0].winner_pick_id, sixth.round.winner_id, "old round untouched");
ok("new round after the reveal");

// --- Timeout with fewer than 6 -------------------------------------------------------
await rpc(pool, "bookclub_submit_pick", { p_round_id: next.round.id, ...book(12) });
await rpc(pool, "bookclub_submit_pick", { p_round_id: next.round.id, ...book(13) });
let open = await rpc(pool, "bookclub_get_state", {});
assert.equal(open.round.status, "open");
assert.equal(open.round.count, 3);
await expire(next.round.id, { by: "1 minute" });
const late = await rpc(pool, "bookclub_submit_pick", { p_round_id: next.round.id, ...book(14) });
assert.deepEqual([late.ok, late.error], [false, "closed"], "submit after the hour is refused");
assert.equal(late.round.status, "picked", "and that call closes it");
assert.equal(late.round.picks.length, 3, "wheel has only the 3 that came in");
assert.equal(late.round.closed_at, late.round.closes_at, "timed-out round closes at the deadline");
const after = await rpc(pool, "bookclub_get_state", {});
assert.equal(after.round.winner_id, late.round.winner_id);
ok("timeout with 3 of 6: closes at the hour, wheel of 3, one winner");

// --- Timeout with none ----------------------------------------------------------------
const lonely = await rpc(pool, "bookclub_start_round", {});
await expire(lonely.round.id, { by: "1 hour" });
const empty = await rpc(pool, "bookclub_get_state", {});
assert.equal(empty.round.status, "empty");
assert.equal(empty.round.winner_id, null);
assert.deepEqual(empty.round.picks, []);
const restart = await rpc(pool, "bookclub_start_round", {});
assert.equal(restart.started, true, "can start again after an empty round");
ok("timeout with nobody: empty, can start again");

// --- Timeout settled by Start ------------------------------------------------------------
await rpc(pool, "bookclub_submit_pick", { p_round_id: restart.round.id, ...book(21) });
await expire(restart.round.id, { by: "1 hour" });
const viaStart = await rpc(pool, "bookclub_start_round", {});
assert.equal(viaStart.started, true);
const settled = await sql(pool, "select closed_at, winner_pick_id from public.bookclub_rounds where id = $1", [restart.round.id]);
assert.ok(settled[0].closed_at && settled[0].winner_pick_id, "Start closes and draws the expired round first");
const openCount = await sql(pool, "select count(*)::int as n from public.bookclub_rounds where closed_at is null");
assert.equal(openCount[0].n, 1);
ok("an expired round is drawn before a new one opens");

// --- Races ------------------------------------------------------------------------------
await expireOpen();
await rpc(pool, "bookclub_get_state", {});
const starts = await Promise.all(Array.from({ length: 8 }, () => rpc(pool, "bookclub_start_round", {})));
assert.equal(starts.filter((s) => s.started).length, 1, "eight simultaneous Starts open one round");
assert.equal(new Set(starts.map((s) => s.round.id)).size, 1);
const raceRound = starts[0].round.id;
const subs = await Promise.all(Array.from({ length: 9 }, (_, i) => rpc(pool, "bookclub_submit_pick", { p_round_id: raceRound, ...book(30 + i) })));
const accepted = subs.filter((s) => s.ok);
assert.equal(accepted.length, 6, "nine at once: six seats");
assert.ok(subs.filter((s) => !s.ok).every((s) => ["closed", "full"].includes(s.error)));
const raced = await rpc(pool, "bookclub_get_state", {});
assert.equal(raced.round.status, "picked");
assert.equal(raced.round.count, 6);
const views = await Promise.all(Array.from({ length: 10 }, () => rpc(pool, "bookclub_get_state", {})));
assert.equal(new Set(views.map((v) => v.round.winner_id)).size, 1);
ok("races: simultaneous Starts and a 9-way submit rush");

// --- Rate limit -------------------------------------------------------------------------
let limited = false;
for (let i = 0; i < 40 && !limited; i += 1) {
  const r = await rpc(pool, "bookclub_start_round", {}, { ip: "198.51.100.9" });
  limited = r.ok === false && r.error === "rate";
}
assert.ok(limited, "Start is rate limited per address");
ok("rate limit");

// --- Winner distribution sanity -------------------------------------------------------------
const tally = new Map();
for (let i = 0; i < 120; i += 1) {
  await expireOpen();
  await sql(pool, "delete from public.bookclub_rate_limits");
  const s = await rpc(pool, "bookclub_start_round", {});
  for (let n = 1; n <= 3; n += 1) await rpc(pool, "bookclub_submit_pick", { p_round_id: s.round.id, ...book(n) });
  await expire(s.round.id);
  const done = await rpc(pool, "bookclub_get_state", {});
  const title = done.round.picks.find((p) => p.id === done.round.winner_id).title;
  tally.set(title, (tally.get(title) || 0) + 1);
}
assert.equal(tally.size, 3, `every book can win ${JSON.stringify([...tally])}`);
for (const n of tally.values()) assert.ok(n > 15, `draw looks uniform ${JSON.stringify([...tally])}`);
ok(`draw is spread over all books ${JSON.stringify(Object.fromEntries(tally))}`);

await pool.end();
console.log("all database checks passed");
