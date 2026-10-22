// Measures the spin's frame rate, then records it on a phone-sized screen and
// writes spin.mp4 and spin.gif. Six real books, drawn by the local database.
//
//   node tools/record-spin.mjs [out-dir]     (needs ffmpeg for mp4/gif)
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { freshDatabase, rpc } from "./local-db.mjs";
import { serveSite, phone, open } from "./harness.mjs";

const out = process.argv[2] || "/tmp/bookclub-spin";
fs.mkdirSync(out, { recursive: true });
const server = await serveSite();

const books = [
  "the secret history",
  "lessons in chemistry",
  "tomorrow and tomorrow and tomorrow",
  "demon copperhead",
  "the covenant of water",
  "circe madeline miller",
];

async function lookup(q) {
  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=1&fields=key,title,author_name,cover_i`);
  const doc = (await res.json()).docs[0];
  return {
    p_title: doc.title,
    p_author: doc.author_name?.[0] ?? null,
    p_cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
    p_source_key: doc.key,
  };
}
const picks = [];
for (const q of books) picks.push(await lookup(q));

async function closedRound() {
  const pool = await freshDatabase();
  const { round } = await rpc(pool, "bookclub_start_round", {});
  for (const pick of picks) await rpc(pool, "bookclub_submit_pick", { p_round_id: round.id, ...pick });
  return pool;
}

const browser = await chromium.launch({ args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"] });

// 1. Frame timing, no recorder attached.
{
  const pool = await closedRound();
  const p = await phone(browser, pool, "iphone-15", { scale: 3 });
  await p.page.addInitScript(() => {
    window.__frames = [];
    const loop = (t) => {
      if (document.getElementById("view-reveal")?.dataset.phase === "spin") window.__frames.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await open(p.page);
  await p.page.waitForFunction(() => document.getElementById("view-reveal").dataset.phase === "done", null, { timeout: 30000 });
  const frames = await p.page.evaluate(() => window.__frames);
  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const p95 = gaps[Math.floor(gaps.length * 0.95)];
  const long = gaps.filter((g) => g > 25).length;
  const fps = 1000 / median;
  console.log(`spin frames: ${frames.length}, median ${median.toFixed(1)}ms (${fps.toFixed(0)} fps), p95 ${p95.toFixed(1)}ms, ${long} over 25ms`);
  assert.ok(fps >= 55, `spin should hold ~60fps (median ${median.toFixed(1)}ms)`);
  fs.writeFileSync(`${out}/frame-timing.json`, JSON.stringify({ frames: frames.length, medianMs: median, p95Ms: p95, over25ms: long }, null, 2));
  await p.context.close();
  await pool.end();
}

// 2. Recording.
{
  const pool = await closedRound();
  const dir = `${out}/raw`;
  fs.rmSync(dir, { recursive: true, force: true });
  const p = await phone(browser, pool, "iphone-15", { scale: 2, recordVideo: { dir, size: { width: 390, height: 844 } } });
  await open(p.page);
  await p.page.waitForFunction(() => document.getElementById("view-reveal").dataset.phase === "done", null, { timeout: 30000 });
  await p.page.waitForTimeout(1500);
  const video = p.page.video();
  await p.context.close();
  const webm = await video.path();
  await pool.end();
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", `${out}/spin.mp4`]);
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error", "-i", webm,
      "-vf", "fps=20,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=sierra2_4a",
      `${out}/spin.gif`,
    ]);
    console.log(`wrote ${out}/spin.mp4 and ${out}/spin.gif`);
  } catch (error) {
    console.log(`ffmpeg unavailable; raw recording at ${webm}`);
  }
}

await browser.close();
server.close();
