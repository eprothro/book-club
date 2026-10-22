import { CLUB, SPINNER, TOKEN_KEY, SEEN_KEY } from "./config.js";
import { rpc, warm } from "./api.js";
import { searchBooks, thumb } from "./covers.js";
import { createWheel } from "./wheel.js";
import { drawnCoverHTML } from "./drawn.js";

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const store = {
  get(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  },
  set(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* private mode: this phone just won't remember */
    }
  },
};

const state = {
  round: null,
  offset: 0,
  token: store.get(TOKEN_KEY),
  view: "loading",
  choice: null,
  editing: false,
  busy: false,
  wheels: {},
  revealFor: null,
  revealing: false,
  lastFetch: 0,
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let inflight = null;

function apply(data) {
  if (!data) return;
  if (typeof data.now === "number") state.offset = data.now - Date.now();
  if ("round" in data) state.round = data.round;
  if (data.token) {
    state.token = data.token;
    store.set(TOKEN_KEY, data.token);
  }
  render();
}

async function refresh() {
  if (inflight) return inflight;
  state.lastFetch = Date.now();
  inflight = rpc("bookclub_get_state", { p_token: state.token || null })
    .then(apply)
    .catch(() => {
      if (state.view === "loading") toast("Can't reach the club right now. Pull to retry.");
    })
    .finally(() => {
      inflight = null;
      schedule();
    });
  return inflight;
}

let pollTimer = 0;
function schedule() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  const every = { open: 4000, reveal: 12000, idle: 8000, empty: 8000 }[state.view] ?? 6000;
  pollTimer = setTimeout(refresh, every);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
  else clearTimeout(pollTimer);
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) refresh();
});

const now = () => Date.now() + state.offset;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function targetView() {
  const round = state.round;
  if (!round) return "idle";
  if (round.status === "open") return "open";
  if (round.status === "empty") return "empty";
  return "reveal";
}

function show(view) {
  if (state.view === view) return false;
  state.view = view;
  document.body.dataset.view = view;
  for (const el of document.querySelectorAll(".view")) {
    el.hidden = el.id !== `view-${view}`;
  }
  window.scrollTo(0, 0);
  return true;
}

function render() {
  // Never yank the reveal away mid-spin; the next poll catches up.
  if (state.revealing) return;
  const view = targetView();
  const entered = show(view);
  if (view === "idle") enterIdle();
  if (view === "empty") enterEmpty();
  if (view === "open") renderOpen(entered);
  if (view === "reveal") enterReveal();
}

function enterIdle() {
  if (!state.wheels.idle) {
    state.wheels.idle = createWheel($("idle-wheel"), { picks: [], spinner: SPINNER });
    state.wheels.idle.idle();
  }
}

function enterEmpty() {
  if (!state.wheels.empty) {
    state.wheels.empty = createWheel($("empty-wheel"), { picks: [], spinner: SPINNER });
    state.wheels.empty.idle();
  }
}

// ---------------------------------------------------------------------------
// Open round
// ---------------------------------------------------------------------------

function buildShelf(cap) {
  const shelf = $("shelf");
  if (shelf.childElementCount === cap) return;
  shelf.textContent = "";
  for (let i = 0; i < cap; i += 1) {
    const spine = document.createElement("i");
    spine.style.setProperty("--i", i);
    shelf.append(spine);
  }
}

function renderOpen(entered) {
  const round = state.round;
  const cap = round.capacity || CLUB.seats;
  buildShelf(cap);
  [...$("shelf").children].forEach((spine, i) => spine.classList.toggle("is-in", i < round.count));
  $("count").textContent = String(round.count);
  $("cap").textContent = String(cap);
  tick();

  if (entered) {
    state.choice = null;
    state.editing = false;
  }
  let pane = "search";
  if (state.choice) pane = "confirm";
  else if (round.mine && !state.editing) pane = "mine";
  setPane(pane);
  if (pane === "mine") fillBook($("mine-book"), round.mine);
  $("keep").hidden = !(round.mine && state.editing);
}

function setPane(pane) {
  document.body.dataset.pane = pane;
  if (pane !== "search") document.body.classList.remove("is-typing");
  for (const name of ["search", "confirm", "mine"]) $(`pane-${name}`).hidden = name !== pane;
}

let lastClock = "";
function tick() {
  if (state.view !== "open" || !state.round) return;
  const left = state.round.closes_at - now();
  const secs = Math.max(0, Math.ceil(left / 1000));
  const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  if (text !== lastClock) {
    lastClock = text;
    $("clock-time").textContent = text;
    $("clock-label").textContent = secs > 0 ? "left" : "spinning…";
    $("status").classList.toggle("is-ending", secs > 0 && secs <= 60);
  }
  // The hour is up: ask the server, which closes the round and draws.
  if (secs === 0 && Date.now() - state.lastFetch > 1500) refresh();
}
setInterval(tick, 250);

// Book card: cover plus title and author.
function coverEl(book, { large = false } = {}) {
  const wrap = document.createElement("span");
  wrap.className = "cover";
  const url = large ? book.cover_url || book.cover : thumb(book.cover_url || book.cover);
  if (url) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.src = url;
    img.addEventListener("error", () => img.replaceWith(drawnCoverHTML(book)));
    // Open Library answers a missing size with a 1x1 pixel.
    img.addEventListener("load", () => {
      if (img.naturalWidth < 8) img.replaceWith(drawnCoverHTML(book));
    });
    wrap.append(img);
  } else {
    wrap.append(drawnCoverHTML(book));
  }
  return wrap;
}

function fillBook(host, book) {
  const key = `${book.title}|${book.author}|${book.cover_url || book.cover}`;
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  host.textContent = "";
  host.append(coverEl(book, { large: true }));
  const title = document.createElement("p");
  title.className = "book-title";
  title.textContent = book.title;
  host.append(title);
  if (book.author) {
    const by = document.createElement("p");
    by.className = "book-author";
    by.textContent = book.author;
    host.append(by);
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const q = $("q");
let searchTimer = 0;
let searchCtl = null;
let lastQuery = "";

function setHint(text) {
  $("hint").textContent = text;
  $("hint").hidden = !text;
}

function typed() {
  return q.value.trim().replace(/\s+/g, " ");
}

function resultRow(book, { typedOnly = false } = {}) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = typedOnly ? "result result-typed" : "result";
  btn.append(coverEl(book));
  const text = document.createElement("span");
  text.className = "result-text";
  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = typedOnly ? `Use “${book.title}”` : book.title;
  text.append(title);
  const meta = document.createElement("span");
  meta.className = "result-meta";
  meta.textContent = typedOnly ? "No cover, we'll make one" : [book.author, book.year].filter(Boolean).join(" · ");
  if (meta.textContent) text.append(meta);
  btn.append(text);
  btn.addEventListener("click", () => choose(book));
  li.append(btn);
  return li;
}

function renderResults(books, query, { loading = false, failed = false } = {}) {
  const list = $("results");
  list.textContent = "";
  document.body.classList.toggle("has-results", Boolean(query));
  if (!query) {
    setHint("");
    return;
  }
  if (loading) {
    list.classList.add("is-loading");
    for (let i = 0; i < 3; i += 1) {
      const li = document.createElement("li");
      li.className = "skeleton";
      li.innerHTML = '<span class="cover"></span><span class="lines"><i></i><i></i></span>';
      list.append(li);
    }
    setHint("");
    return;
  }
  list.classList.remove("is-loading");
  for (const book of books) list.append(resultRow(book));
  list.append(resultRow({ title: query, author: null, cover: null, key: null }, { typedOnly: true }));
  if (failed) setHint("Covers are napping. You can still use your title.");
  else if (!books.length) setHint("No covers found.");
  else setHint("");
}

function runSearch() {
  const query = typed();
  $("clear").hidden = !q.value;
  if (query === lastQuery) return;
  lastQuery = query;
  clearTimeout(searchTimer);
  searchCtl?.abort();
  if (query.length < 2) {
    renderResults([], "");
    return;
  }
  renderResults([], query, { loading: true });
  searchTimer = setTimeout(async () => {
    const ctl = new AbortController();
    searchCtl = ctl;
    try {
      const books = await searchBooks(query, { signal: ctl.signal });
      if (ctl.signal.aborted || typed() !== query) return;
      renderResults(books, query);
    } catch (error) {
      if (error?.name === "AbortError" || ctl.signal.aborted) return;
      renderResults([], query, { failed: true });
    }
  }, 280);
}

q.addEventListener("input", runSearch);
$("search").addEventListener("submit", (event) => {
  event.preventDefault();
  q.blur();
});
$("clear").addEventListener("click", () => {
  q.value = "";
  runSearch();
  q.focus();
});
q.addEventListener("focus", () => document.body.classList.add("is-typing"));
q.addEventListener("blur", () => {
  if (!typed()) document.body.classList.remove("is-typing");
});

function choose(book) {
  state.choice = {
    title: book.title,
    author: book.author || null,
    cover_url: book.cover || null,
    source_key: book.key || null,
  };
  q.blur();
  $("confirm-error").hidden = true;
  fillBook($("confirm-book"), state.choice);
  setPane("confirm");
  window.scrollTo(0, 0);
  $("confirm").focus({ preventScroll: true });
}

$("back").addEventListener("click", () => {
  state.choice = null;
  setPane("search");
  q.focus();
});

$("change").addEventListener("click", () => {
  state.editing = true;
  q.value = "";
  lastQuery = "\u0000";
  runSearch();
  renderOpen(false);
  q.focus();
});

$("keep").addEventListener("click", () => {
  state.editing = false;
  q.value = "";
  runSearch();
  document.body.classList.remove("is-typing");
  renderOpen(false);
});

$("confirm").addEventListener("click", async () => {
  if (state.busy || !state.choice || !state.round) return;
  state.busy = true;
  const btn = $("confirm");
  btn.classList.add("is-busy");
  btn.disabled = true;
  try {
    const data = await rpc("bookclub_submit_pick", {
      p_round_id: state.round.id,
      p_title: state.choice.title,
      p_author: state.choice.author,
      p_cover_url: state.choice.cover_url,
      p_source_key: state.choice.source_key,
      p_token: state.token || null,
    });
    if (data?.ok) {
      state.choice = null;
      state.editing = false;
      q.value = "";
      lastQuery = "";
      renderResults([], "");
      document.body.classList.remove("is-typing");
      apply(data);
    } else if (data?.error === "closed" || data?.error === "full") {
      state.choice = null;
      toast(data.error === "full" ? "All the seats filled up." : "Picks just closed.");
      apply(data);
    } else if (data?.error === "rate") {
      showError("Too many tries. Give it a minute.");
    } else {
      showError("That title didn't take. Try another.");
    }
  } catch {
    showError("Couldn't send it. Check your signal and try again.");
  } finally {
    state.busy = false;
    btn.disabled = false;
    btn.classList.remove("is-busy");
  }
});

function showError(text) {
  const el = $("confirm-error");
  el.textContent = text;
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start(button) {
  if (state.busy) return;
  state.busy = true;
  button.classList.add("is-busy");
  button.disabled = true;
  try {
    const data = await rpc("bookclub_start_round", { p_token: state.token || null });
    if (data?.ok === false && data.error === "rate") toast("Easy there. Try again in a few minutes.");
    else apply(data);
  } catch {
    toast("Couldn't start. Check your signal and try again.");
  } finally {
    state.busy = false;
    button.disabled = false;
    button.classList.remove("is-busy");
    disarm();
  }
}

$("start").addEventListener("click", (e) => start(e.currentTarget));
$("restart").addEventListener("click", (e) => start(e.currentTarget));

// "New round" sits under the result, so a stray tap must not end it.
let armTimer = 0;
function disarm() {
  clearTimeout(armTimer);
  const again = $("again");
  again.classList.remove("is-armed");
  again.textContent = "New round";
}
$("again").addEventListener("click", (e) => {
  const again = e.currentTarget;
  if (!again.classList.contains("is-armed")) {
    again.classList.add("is-armed");
    again.textContent = "Tap again to start";
    armTimer = setTimeout(disarm, 3500);
    return;
  }
  start(again);
});

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

function seen(id) {
  return store.get(SEEN_KEY) === id;
}

function preload(urls, timeout = 2500) {
  const loads = urls.filter(Boolean).map(
    (url) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = img.onerror = resolve;
        img.src = url;
      }),
  );
  return Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeout))]);
}

function fillWinner(pick) {
  const host = $("winner-cover");
  host.textContent = "";
  host.append(coverEl(pick, { large: true }));
  $("winner-title").textContent = pick.title;
  $("winner-author").textContent = pick.author ? `by ${pick.author}` : "";
}

async function enterReveal() {
  const round = state.round;
  if (state.revealFor === round.id) return;
  state.revealFor = round.id;
  const view = $("view-reveal");
  const index = Math.max(0, round.picks.findIndex((p) => p.id === round.winner_id));
  const pick = round.picks[index];
  state.wheels.reveal?.destroy();
  state.wheels.reveal = createWheel($("reveal-wheel"), { picks: round.picks, spinner: SPINNER });
  fillWinner(pick);
  const n = round.picks.length;
  const missed = (round.capacity || CLUB.seats) - n;
  $("caption").textContent = `${n} ${n === 1 ? "book" : "books"} in the circle${missed > 0 ? ` · ${missed} sat out` : ""}`;
  disarm();

  if (seen(round.id)) {
    state.wheels.reveal.pointAt(index, round.spin_seed);
    view.dataset.phase = "done";
    return;
  }
  await play(index, round, { first: true });
}

async function play(index, round, { first = false } = {}) {
  const view = $("view-reveal");
  const wheel = state.wheels.reveal;
  state.revealing = true;
  view.dataset.phase = "spin";
  if (first) await preload(round.picks.map((p) => p.cover_url));
  await new Promise((r) => setTimeout(r, first ? 450 : 150));
  await wheel.spin(index, round.spin_seed, { reduced: reducedMotion.matches });
  view.dataset.phase = "landed";
  store.set(SEEN_KEY, round.id);
  await new Promise((r) => setTimeout(r, reducedMotion.matches ? 200 : 650));
  view.dataset.phase = "revealed";
  if (!reducedMotion.matches) confetti();
  await new Promise((r) => setTimeout(r, reducedMotion.matches ? 100 : 1300));
  view.dataset.phase = "done";
  state.revealing = false;
  // Anything that changed during the show (say, a new round) shows now.
  render();
}

$("replay").addEventListener("click", () => {
  const round = state.round;
  if (!round || state.revealing || round.status !== "picked") return;
  const index = Math.max(0, round.picks.findIndex((p) => p.id === round.winner_id));
  play(index, round);
});

function confetti() {
  const host = $("confetti");
  host.textContent = "";
  const colors = ["#7d2e3a", "#d9a3a5", "#f3c24f", "#7f9a7a", "#34456b", "#f6efe0"];
  for (let i = 0; i < 44; i += 1) {
    const bit = document.createElement("i");
    const book = i % 5 === 0;
    bit.className = book ? "bit bit-book" : "bit";
    bit.style.setProperty("--x", `${(Math.random() * 100).toFixed(1)}vw`);
    bit.style.setProperty("--drift", `${((Math.random() - 0.5) * 30).toFixed(1)}vw`);
    bit.style.setProperty("--spin", `${Math.round((Math.random() - 0.5) * 900)}deg`);
    bit.style.setProperty("--d", `${(Math.random() * 0.5).toFixed(2)}s`);
    bit.style.setProperty("--t", `${(1.8 + Math.random() * 1.2).toFixed(2)}s`);
    bit.style.setProperty("--c", colors[i % colors.length]);
    host.append(bit);
  }
  setTimeout(() => {
    host.textContent = "";
  }, 3600);
}

// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 3200);
}

warm();
refresh();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
