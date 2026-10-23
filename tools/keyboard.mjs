// The search step with the on-screen keyboard up, on iPhone and Android sizes:
// focus, type letter by letter, scroll the matches, pick one, and the keyboard
// goes away.
//
// Android Chrome (interactive-widget=resizes-content) shrinks the layout
// viewport to the space above the keyboard; the test resizes the viewport.
// iOS Safari keeps the layout viewport and covers the bottom with the
// keyboard, and lets the page scroll by the keyboard's height; the test draws
// the keyboard over the page and adds that scroll room. Screenshots show the
// keyboard so they look like the phone.
//
//   node tools/keyboard.mjs        (BOOKCLUB_SHOTS=/tmp/shots to save screenshots)
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import { freshDatabase, rpc } from "./local-db.mjs";
import { serveSite, phone, open, settle, PHONES } from "./harness.mjs";

const shots = process.env.BOOKCLUB_SHOTS || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
const server = await serveSite();
const pool = await freshDatabase();
await rpc(pool, "bookclub_start_round", {});

const cases = [
  { engine: webkit, os: "ios", device: "iphone-se" },
  { engine: webkit, os: "ios", device: "iphone-15" },
  { engine: chromium, os: "android", device: "android-small" },
  { engine: chromium, os: "android", device: "pixel" },
];

// Draws a keyboard and gives the page iOS's extra scroll room.
function showKeyboard(page, os, height) {
  return page.evaluate(
    ({ os, height }) => {
      const kb = document.createElement("div");
      kb.id = "__kb";
      const dark = os === "android";
      kb.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${height}px;z-index:99;pointer-events:none;
        background:${dark ? "#e8eaed" : "#d1d4da"};display:flex;flex-direction:column;justify-content:${os === "ios" ? "flex-start" : "center"};
        gap:${os === "ios" ? 11 : 9}px;padding:${os === "ios" ? 10 : 8}px 4px;box-sizing:border-box`;
      const rows = ["qwertyuiop", "asdfghjkl", "⇧zxcvbnm⌫", "123 space ⏎"];
      for (const row of rows) {
        const r = document.createElement("div");
        r.style.cssText = "display:flex;gap:6px;justify-content:center";
        const keys = row.includes(" ") ? row.split(" ") : [...row];
        for (const k of keys) {
          const key = document.createElement("span");
          const wide = k === "space" ? 190 : k.length > 1 || "⇧⌫⏎".includes(k) ? 46 : 0;
          key.textContent = k === "space" ? "" : k;
          key.style.cssText = `display:grid;place-items:center;height:${os === "ios" ? 42 : 44}px;${wide ? `width:${wide}px` : "flex:1;max-width:34px"};
            border-radius:${os === "ios" ? 5 : 6}px;background:#fff;box-shadow:0 1px 0 rgba(0,0,0,.3);font:400 20px -apple-system,Roboto,sans-serif;color:#111`;
          r.append(key);
        }
        kb.append(r);
      }
      document.body.append(kb);
      if (os === "ios") {
        const spacer = document.createElement("div");
        spacer.id = "__kbspace";
        spacer.style.height = `${height}px`;
        document.body.append(spacer);
      }
    },
    { os, height },
  );
}

// Android draws the page above the keyboard, so the shot shows the resized
// page with the keyboard under it: full height, keyboard drawn, same scroll.
async function snap(page, os, viewport, keyboard, path) {
  if (!shots) return;
  if (os === "ios") {
    await page.screenshot({ path });
    return;
  }
  const y = await page.evaluate(() => scrollY);
  await page.setViewportSize(viewport);
  await showKeyboard(page, "android", keyboard);
  await page.evaluate(() => {
    document.getElementById("__kb").style.zIndex = 99;
    const spacer = document.createElement("div");
    spacer.id = "__kbspace";
    spacer.style.height = "2000px";
    document.body.append(spacer);
  });
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(150);
  await page.screenshot({ path });
  await hideKeyboard(page);
  await page.setViewportSize({ width: viewport.width, height: viewport.height - keyboard });
  await page.evaluate((top) => window.scrollTo(0, top), y);
}

function hideKeyboard(page) {
  return page.evaluate(() => {
    document.getElementById("__kb")?.remove();
    document.getElementById("__kbspace")?.remove();
  });
}

// The part of the screen the keyboard doesn't cover.
async function visibleBottom(page, os, keyboard) {
  const vh = await page.evaluate(() => innerHeight);
  return os === "ios" ? vh - keyboard : vh;
}

async function rect(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
  });
}

for (const { engine, os, device } of cases) {
  const browser = await engine.launch();
  const p = await phone(browser, pool, device, { ip: `198.51.100.${Math.floor(Math.random() * 200)}` });
  const { page } = p;
  const { viewport, keyboard } = PHONES[device];
  const label = `${os} ${device} ${viewport.width}x${viewport.height}`;
  await open(page);
  assert.equal(await page.evaluate(() => document.body.dataset.view), "open", label);

  const fontSize = await page.locator("#q").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(fontSize >= 16, `${label}: input font ${fontSize}px would make iOS zoom`);

  // Focus: the keyboard comes up.
  await page.locator("#q").tap();
  if (os === "android") await page.setViewportSize({ width: viewport.width, height: viewport.height - keyboard });
  else await showKeyboard(page, os, keyboard);
  await page.waitForFunction(() => document.body.classList.contains("is-typing"));
  await settle(page, 400);
  const status = await rect(page, "#status");
  assert.ok(status.height <= 60, `${label}: status tucks away while typing (${status.height})`);
  const bottom = await visibleBottom(page, os, keyboard);
  let field = await rect(page, "#q");
  assert.ok(field.top >= 0 && field.bottom <= bottom - 8, `${label}: field above the keyboard (${field.bottom} vs ${bottom})`);
  await snap(page, os, viewport, keyboard, `${shots}/kb-${device}-focus.png`);

  // Type letter by letter; the field must not jump around under the thumb.
  const tops = [];
  for (const ch of "the night circus") {
    await page.keyboard.type(ch);
    tops.push((await rect(page, "#q")).top);
    await page.waitForTimeout(40);
  }
  assert.ok(Math.max(...tops) - Math.min(...tops) < 2, `${label}: field moved while typing ${Math.min(...tops)}..${Math.max(...tops)}`);
  assert.equal(await page.locator("#q").inputValue(), "the night circus");
  await page.waitForFunction(() => {
    const list = document.getElementById("results");
    return !list.classList.contains("is-loading") && list.querySelector(".result:not(.result-typed)");
  }, null, { timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".result img")].every((i) => i.complete));
  await settle(page, 300);
  field = await rect(page, "#q");
  assert.ok(field.bottom <= bottom - 8, `${label}: field still above the keyboard`);
  const rows = await page.locator(".results .result").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().bottom));
  const above = rows.filter((b) => b <= bottom).length;
  const minRows = viewport.height < 700 ? 1 : 2;
  assert.ok(above >= minRows, `${label}: ${above} matches above the keyboard`);
  await snap(page, os, viewport, keyboard, `${shots}/kb-${device}-results.png`);

  // Scroll to the last option (use my title) and make sure it clears the keyboard.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(page, 250);
  const last = await rect(page, ".result-typed");
  assert.ok(last.bottom <= bottom + 1 && last.top >= 0, `${label}: last option reachable (${last.top}-${last.bottom} vs ${bottom})`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(wide <= 1, `${label}: sideways scroll ${wide}`);
  await snap(page, os, viewport, keyboard, `${shots}/kb-${device}-scrolled.png`);

  // Scroll back up and tap a match: the keyboard goes, the choice is in view.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".result:not(.result-typed)").first().tap();
  await page.waitForFunction(() => document.body.dataset.pane === "confirm");
  const focused = await page.evaluate(() => document.activeElement?.id);
  assert.notEqual(focused, "q", `${label}: field gave up focus, so the keyboard closes`);
  await hideKeyboard(page);
  if (os === "android") await page.setViewportSize(viewport);
  await settle(page, 600);
  const confirm = await rect(page, "#confirm");
  const vh = await page.evaluate(() => innerHeight);
  assert.ok(confirm.bottom <= vh && confirm.top >= 0, `${label}: Pick this one in view (${confirm.bottom} vs ${vh})`);
  if (shots) await page.screenshot({ path: `${shots}/kb-${device}-confirm.png` });

  // Back to search puts the cursor back in the field with the query intact.
  await page.locator("#back").tap();
  await page.waitForFunction(() => document.body.dataset.pane === "search");
  assert.equal(await page.locator("#q").inputValue(), "the night circus");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "q");

  console.log(`ok ${label}: focus, type, ${above} above the keyboard, scroll to the end, pick, keyboard down`);
  await p.context.close();
  await browser.close();
}

server.close();
await pool.end();
console.log("all keyboard checks passed");
