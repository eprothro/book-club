// Every branch of a round, with six phones in their own browser contexts,
// against a local Postgres running the real migration. Covers come from Open
// Library (cached in /tmp after the first run).
//
//   sudo service postgresql start
//   npm install && npx playwright install chromium webkit
//   node tools/flows.mjs                     (BOOKCLUB_ENGINES=webkit to pick one)
//   BOOKCLUB_SHOTS=/tmp/shots node tools/flows.mjs
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import { freshDatabase, rpc, sql } from "./local-db.mjs";
import { serveSite, phone, open, view, pane, settle } from "./harness.mjs";

const shots = process.env.BOOKCLUB_SHOTS || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const engines = (process.env.BOOKCLUB_ENGINES || "chromium,webkit").split(",");
const server = await serveSite();

async function shot(page, name) {
  if (!shots) return;
  await settle(page, 350);
  await page.screenshot({ path: `${shots}/${name}.png` });
  console.log("  shot", name);
}

async function expire(pool, { inMs = 0 } = {}) {
  await sql(
    pool,
    `with d as (select closes_at - now() - make_interval(secs => $1::double precision / 1000) as shift
               from public.bookclub_rounds where closed_at is null)
     update public.bookclub_rounds
       set opened_at = opened_at - d.shift, closes_at = closes_at - d.shift, closed_at = closed_at - d.shift
     from d`,
    [inMs],
  );
}

async function search(page, text) {
  await page.locator("#q").fill(text);
  await page.waitForFunction(
    (t) => {
      const list = document.getElementById("results");
      const typed = list.querySelector(".result-typed .result-title");
      return !list.classList.contains("is-loading") && typed && typed.textContent.includes(t);
    },
    text.trim(),
    { timeout: 20000 },
  );
}

async function pickFirst(page, text) {
  await search(page, text);
  const first = page.locator(".result:not(.result-typed)").first();
  const title = (await first.locator(".result-title").innerText()).trim();
  await first.click();
  await page.waitForFunction(() => document.body.dataset.pane === "confirm");
  await page.locator("#confirm").click();
  return title;
}

async function waitFor(page, fn, arg, timeout = 15000) {
  await page.waitForFunction(fn, arg, { timeout });
}

const waitView = (page, v, timeout) => waitFor(page, (want) => document.body.dataset.view === want, v, timeout);
const waitPhase = (page, p, timeout = 20000) =>
  waitFor(page, (want) => document.getElementById("view-reveal").dataset.phase === want, p, timeout);

async function clockSeconds(page) {
  const text = await page.locator("#clock-time").innerText();
  const [m, s] = text.split(":").map(Number);
  return m * 60 + s;
}

async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  assert.ok(o.sw <= o.w + 1, `${label}: horizontal overflow ${o.sw} > ${o.w}`);
}

async function spinnerAngle(page) {
  return page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector("#reveal-wheel .spin-rot")).transform);
    return Math.round(((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360);
  });
}

// The slice her hands point into, from the angle and the wheel's slice count.
async function pointedSlice(page) {
  const n = Number(await page.locator("#reveal-wheel .wheel").getAttribute("data-n"));
  const a = await spinnerAngle(page);
  return Math.round(a / (360 / n)) % n;
}

for (const engine of engines) {
  const browserType = { chromium, webkit }[engine];
  const browser = await browserType.launch();
  const pool = await freshDatabase();
  const tag = (name) => (engine === "chromium" ? name : `${engine}-${name}`);
  console.log(`\n== ${engine}`);

  // --- Start -------------------------------------------------------------
  const jenn = await phone(browser, pool, "iphone-15");
  const jana = await phone(browser, pool, "pixel");
  await open(jenn.page);
  await open(jana.page);
  assert.equal(await view(jenn.page), "idle");
  assert.equal(await jenn.page.locator("#start").innerText(), "Start");
  await noOverflow(jenn.page, "idle");
  await shot(jenn.page, tag("01-idle-iphone15"));
  await jenn.page.locator("#start").click();
  await waitView(jenn.page, "open");
  const startClock = await clockSeconds(jenn.page);
  assert.ok(startClock >= 3590 && startClock <= 3600, `clock starts at an hour (${startClock})`);
  assert.equal(await jenn.page.locator("#tally-label").innerText(), "0 of 6 in");
  assert.equal(await pane(jenn.page), "search");
  await shot(jenn.page, tag("02-open-iphone15"));
  // Jana's phone was already open on the idle screen; the poll brings the round in.
  await waitView(jana.page, "open", 12000);
  // A second Start (e.g. a stale screen) joins the same round.
  const again = await rpc(pool, "bookclub_start_round", {});
  assert.equal(again.started, false);
  console.log("ok start: one-hour window, shared live with an already-open phone");

  // --- Submit ------------------------------------------------------------
  await search(jenn.page, "the secret history");
  const rows = await jenn.page.locator(".result:not(.result-typed)").count();
  assert.ok(rows >= 2 && rows <= 5, `a few matches (${rows})`);
  const covers = await jenn.page.locator(".result:not(.result-typed) .cover img").count();
  assert.ok(covers >= 2, "matches show real covers");
  await jenn.page.waitForFunction(() => [...document.querySelectorAll(".result .cover img")].every((i) => i.complete));
  await noOverflow(jenn.page, "results");
  await shot(jenn.page, tag("03-search-results-iphone15"));
  await jenn.page.locator(".result:not(.result-typed)").first().click();
  await waitFor(jenn.page, () => document.body.dataset.pane === "confirm");
  assert.match(await jenn.page.locator("#confirm-book .book-title").innerText(), /Secret History/);
  await shot(jenn.page, tag("04-confirm-iphone15"));
  await jenn.page.locator("#confirm").click();
  await waitFor(jenn.page, () => document.body.dataset.pane === "mine");
  assert.equal(await jenn.page.locator("#tally-label").innerText(), "1 of 6 in");
  assert.match(await jenn.page.locator("#mine-book .book-title").innerText(), /Secret History/);
  const token = await jenn.page.evaluate(() => localStorage.getItem("bookclub-token"));
  assert.match(token, /^[0-9a-f]{64}$/);
  await shot(jenn.page, tag("05-my-pick-iphone15"));
  await waitFor(jana.page, () => document.getElementById("count").textContent === "1", null, 8000);
  assert.equal(await jana.page.locator("#mine-book").innerText(), "", "Jana can't see Jenn's pick");
  const janaText = await jana.page.evaluate(() => document.body.innerText);
  assert.doesNotMatch(janaText, /Secret History/, "titles are secret while open");
  console.log("ok submit: lookup with covers, confirm, token saved, count shared, title hidden");

  // --- Change pick ------------------------------------------------------------
  await jenn.page.locator("#change").click();
  assert.equal(await pane(jenn.page), "search");
  assert.equal(await jenn.page.locator("#keep").isVisible(), true, "a way back to the current pick");
  const changed = await pickFirst(jenn.page, "circe madeline miller");
  await waitFor(jenn.page, () => document.body.dataset.pane === "mine");
  assert.match(await jenn.page.locator("#mine-book .book-title").innerText(), new RegExp(changed.split(" ")[0], "i"));
  assert.equal(await jenn.page.locator("#tally-label").innerText(), "1 of 6 in", "change keeps one seat");
  const stored = await sql(pool, "select title from public.bookclub_picks");
  assert.equal(stored.length, 1);
  assert.match(stored[0].title, /Circe/i);
  // Keep my pick backs out of a change without touching it.
  await jenn.page.locator("#change").click();
  await jenn.page.locator("#q").fill("anything");
  await jenn.page.locator("#keep").click();
  assert.equal(await pane(jenn.page), "mine");
  assert.match(await jenn.page.locator("#mine-book .book-title").innerText(), /Circe/i);
  console.log("ok change pick: replaced in place, still 1 of 6; Keep my pick backs out");

  // --- Reopen mid-window ----------------------------------------------------------
  const before = await clockSeconds(jenn.page);
  await jenn.page.reload();
  await waitView(jenn.page, "open");
  await waitFor(jenn.page, () => document.body.dataset.pane === "mine");
  assert.match(await jenn.page.locator("#mine-book .book-title").innerText(), /Circe/i, "pick restored after reload");
  const after = await clockSeconds(jenn.page);
  assert.ok(after <= before && before - after < 30, `countdown continues (${before} -> ${after})`);
  console.log("ok reopen mid-window: pick and countdown restored");

  // --- Cover search with no results ----------------------------------------------------
  await search(jana.page, "zzqx vworp blint");
  assert.equal(await jana.page.locator(".result:not(.result-typed)").count(), 0);
  assert.equal(await jana.page.locator("#hint").innerText(), "No covers found.");
  assert.equal(await jana.page.locator(".result-typed .result-title").innerText(), "Use “zzqx vworp blint”");
  await shot(jana.page, tag("06-no-results-pixel"));
  // Jana's book club book is real, just not in the catalog yet: she uses her title.
  await search(jana.page, "zzqx vworp blint");
  await jana.page.locator("#q").fill("");
  await jana.page.locator("#q").fill("Our Neighbor's Lemon Tree");
  await waitFor(jana.page, () => {
    const t = document.querySelector(".result-typed .result-title");
    return t && t.textContent.includes("Lemon Tree") && !document.getElementById("results").classList.contains("is-loading");
  }, null, 20000);
  await jana.page.locator(".result-typed").click();
  await waitFor(jana.page, () => document.body.dataset.pane === "confirm");
  assert.equal(await jana.page.locator("#confirm-book .drawn").count(), 1, "drawn cover for a title with no art");
  await shot(jana.page, tag("07-confirm-drawn-cover-pixel"));
  await jana.page.locator("#confirm").click();
  await waitFor(jana.page, () => document.body.dataset.pane === "mine");
  assert.equal(await jana.page.locator("#tally-label").innerText(), "2 of 6 in");
  console.log("ok no results: hint, use-what-I-typed, drawn cover, submitted");

  // --- Search service down -----------------------------------------------------------
  const julie = await phone(browser, pool, "iphone-se", { searchDown: true });
  await open(julie.page);
  await search(julie.page, "lessons in chemistry");
  assert.match(await julie.page.locator("#hint").innerText(), /napping/);
  await shot(julie.page, tag("08-search-down-iphonese"));
  await julie.context.close();
  console.log("ok search down: still lets you use your title");

  // --- Early close at 6 -------------------------------------------------------------
  const others = [];
  const queries = ["lessons in chemistry", "tomorrow and tomorrow and tomorrow", "demon copperhead", "the covenant of water"];
  const sizes = ["iphone-se", "android-small", "iphone-15", "pixel"];
  for (let i = 0; i < queries.length; i += 1) {
    const p = await phone(browser, pool, sizes[i]);
    await open(p.page);
    others.push(p);
  }
  for (let i = 0; i < 3; i += 1) {
    await pickFirst(others[i].page, queries[i]);
    await waitFor(others[i].page, () => document.body.dataset.pane === "mine");
  }
  await waitFor(jenn.page, () => document.getElementById("count").textContent === "5", null, 8000);
  assert.equal(await view(jenn.page), "open", "5 of 6 is still open");
  await shot(jenn.page, tag("09-five-of-six-iphone15"));
  const lastPhone = others[3];
  await pickFirst(lastPhone.page, queries[3]);
  await waitView(lastPhone.page, "reveal", 10000);
  const phones = [jenn, jana, ...others];
  for (const p of phones) await waitView(p.page, "reveal", 12000);
  await waitFor(jenn.page, () => document.getElementById("view-reveal").dataset.phase === "spin");
  assert.equal(await jenn.page.locator("#reveal-wheel .wheel").getAttribute("data-n"), "6");
  assert.equal(await jenn.page.locator("#caption").innerText(), "6 books in the circle");
  await jenn.page.waitForTimeout(2600);
  await shot(jenn.page, tag("10-spinning-iphone15"));
  for (const p of phones) await waitPhase(p.page, "done", 25000);
  await shot(jenn.page, tag("11-reveal-iphone15"));
  await shot(others[0].page, tag("11b-reveal-iphonese"));
  await shot(jana.page, tag("11c-reveal-pixel"));
  const db = await sql(pool, `select p.title, r.spin_seed from public.bookclub_rounds r join public.bookclub_picks p on p.id = r.winner_pick_id`);
  const titles = new Set();
  const angles = new Set();
  for (const p of phones) {
    titles.add(await p.page.locator("#winner-title").innerText());
    angles.add(await spinnerAngle(p.page));
    const order = await p.page.evaluate(() => [...document.querySelectorAll("#reveal-wheel .seg")].length);
    assert.equal(order, 6);
    await noOverflow(p.page, `reveal ${p.name}`);
  }
  assert.deepEqual([...titles], [db[0].title], "every phone shows the database's one winner");
  assert.equal(angles.size, 1, `every phone's spinner stops at the same angle ${[...angles]}`);
  const winnerIndex = await jenn.page.evaluate(() => Number(document.querySelector("#reveal-wheel .seg.is-winner").dataset.i));
  assert.equal(await pointedSlice(jenn.page), winnerIndex, "her hands point at the winning slice");
  console.log(`ok early close at 6: all ${phones.length} phones spun to "${db[0].title}" at ${[...angles][0]}°`);

  // --- Reopen after the pick ---------------------------------------------------------------
  await jenn.page.reload();
  await waitView(jenn.page, "reveal");
  assert.equal(await jenn.page.locator("#view-reveal").getAttribute("data-phase"), "done", "seen once: straight to the result");
  assert.equal(await jenn.page.locator("#winner-title").innerText(), db[0].title);
  const katie = await phone(browser, pool, "iphone-15");
  await open(katie.page);
  assert.equal(await view(katie.page), "reveal");
  assert.equal(await katie.page.locator("#view-reveal").getAttribute("data-phase"), "spin", "first visit after the pick plays the spin");
  await waitPhase(katie.page, "done", 25000);
  assert.equal(await katie.page.locator("#winner-title").innerText(), db[0].title);
  assert.equal(await spinnerAngle(katie.page), [...angles][0]);
  await katie.page.reload();
  await waitView(katie.page, "reveal");
  assert.equal(await katie.page.locator("#view-reveal").getAttribute("data-phase"), "done", "and only once");
  await katie.page.locator("#replay").click();
  await waitFor(katie.page, () => document.getElementById("view-reveal").dataset.phase !== "done");
  await waitPhase(katie.page, "done", 25000);
  assert.equal(await katie.page.locator("#winner-title").innerText(), db[0].title, "replay never re-rolls");
  await shot(jenn.page, tag("12-reopened-after-pick-iphone15"));
  const rounds = await sql(pool, "select count(*)::int as n from public.bookclub_rounds");
  assert.equal(rounds[0].n, 1);
  console.log("ok reopen after the pick: animation once per phone, then the result; replay is the same pick");

  // --- New round ------------------------------------------------------------------------
  await jenn.page.locator("#again").click();
  assert.equal(await jenn.page.locator("#again").innerText(), "Tap again to start");
  await shot(jenn.page, tag("13-new-round-armed-iphone15"));
  assert.equal(await view(jenn.page), "reveal", "one tap does not start a round");
  await jenn.page.locator("#again").click();
  await waitView(jenn.page, "open");
  assert.equal(await jenn.page.locator("#tally-label").innerText(), "0 of 6 in");
  assert.equal(await pane(jenn.page), "search", "my old pick doesn't carry over");
  for (const p of [jana, ...others]) await waitView(p.page, "open", 15000);
  console.log("ok new round: two taps, everyone moves to the open round");

  // --- Timeout with fewer than 6 -------------------------------------------------------------
  await pickFirst(jenn.page, "the remains of the day");
  await pickFirst(jana.page, "pachinko");
  await pickFirst(others[0].page, "the poisonwood bible");
  await waitFor(jenn.page, () => document.getElementById("count").textContent === "3", null, 8000);
  // Nine seconds left: the phones count down to zero and ask the server, which draws.
  await expire(pool, { inMs: 9000 });
  await waitFor(jenn.page, () => /^0:0[1-8]$/.test(document.getElementById("clock-time").textContent), null, 10000);
  assert.equal(await jenn.page.locator("#status").getAttribute("class"), "status is-ending");
  await shot(jenn.page, tag("14-last-seconds-iphone15"));
  await waitView(jenn.page, "reveal", 15000);
  assert.equal(await jenn.page.locator("#reveal-wheel .wheel").getAttribute("data-n"), "3");
  assert.equal(await jenn.page.locator("#caption").innerText(), "3 books in the circle · 3 sat out");
  await waitPhase(jenn.page, "done", 25000);
  await shot(jenn.page, tag("15-timeout-three-books-iphone15"));
  const three = await sql(pool, `select p.title from public.bookclub_rounds r join public.bookclub_picks p on p.id = r.winner_pick_id order by r.opened_at desc limit 1`);
  assert.equal(await jenn.page.locator("#winner-title").innerText(), three[0].title);
  const idx3 = await jenn.page.evaluate(() => Number(document.querySelector("#reveal-wheel .seg.is-winner").dataset.i));
  assert.equal(await pointedSlice(jenn.page), idx3);
  // A phone that left a confirm open when time ran out gets told, not an error.
  console.log(`ok timeout with 3: wheel of 3, "${three[0].title}"`);

  // --- Late submit -------------------------------------------------------------------------
  await jenn.page.locator("#again").click();
  await jenn.page.locator("#again").click();
  await waitView(jenn.page, "open");
  await waitView(jana.page, "open", 15000);
  await search(jana.page, "pachinko");
  await jana.page.locator(".result:not(.result-typed)").first().click();
  await waitFor(jana.page, () => document.body.dataset.pane === "confirm");
  await expire(pool, { inMs: -1000 });
  await jana.page.locator("#confirm").click();
  await waitFor(jana.page, () => document.getElementById("toast").classList.contains("is-on"));
  assert.equal(await jana.page.locator("#toast").innerText(), "Picks just closed.");
  await waitView(jana.page, "empty", 10000);
  console.log("ok late submit: told picks closed, no pick recorded");

  // --- Timeout with nobody ---------------------------------------------------------------------
  await waitView(jenn.page, "empty", 15000);
  assert.equal(await jenn.page.locator("#empty-title").innerText(), "No picks came in.");
  await shot(jenn.page, tag("16-empty-iphone15"));
  await jenn.page.locator("#restart").click();
  await waitView(jenn.page, "open");
  console.log("ok timeout with nobody: empty state, start again");

  // --- Offline -----------------------------------------------------------------------------
  const off = await phone(browser, pool, "iphone-se", { offline: true, allowErrors: true });
  await off.page.goto("http://127.0.0.1:8766/");
  await waitFor(off.page, () => document.getElementById("toast").classList.contains("is-on"), null, 15000);
  assert.match(await off.page.locator("#toast").innerText(), /Can't reach/);
  await off.context.close();
  console.log("ok offline: says so instead of hanging");

  // --- Reduced motion -------------------------------------------------------------------------
  await sql(pool, "delete from public.bookclub_rate_limits");
  const calm = await phone(browser, pool, "iphone-15", { reducedMotion: "reduce" });
  await open(calm.page);
  await pickFirst(calm.page, "the remains of the day");
  await expire(pool);
  const t0 = Date.now();
  await waitView(calm.page, "reveal", 15000);
  await waitPhase(calm.page, "done", 10000);
  assert.ok(Date.now() - t0 < 9000, "reduced motion: short spin");
  assert.equal(await calm.page.locator("#reveal-wheel .wheel").getAttribute("data-n"), "1");
  await shot(calm.page, tag("17-one-book-reduced-motion-iphone15"));
  await calm.context.close();
  console.log("ok reduced motion: short spin, one-book wheel");

  for (const p of [jenn, jana, katie, ...others]) await p.context.close();
  await browser.close();
  await pool.end();
}

server.close();
console.log("\nall flows passed");
