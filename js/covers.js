// Book lookup. Open Library is searched by title (not a loose full-text q=),
// then anything that doesn't actually match what was typed is dropped.
// If that isn't already a confident covered hit: the loose index, Google Books,
// and a Wikipedia spelling suggestion (OL again, for the corrected title).
// Any source can time out, 429, or be down; the others still answer.

const OL = "https://openlibrary.org/search.json";
const GB = "https://www.googleapis.com/books/v1/volumes";
const OL_FIELDS = "key,title,author_name,cover_i,isbn,first_publish_year,edition_count";
const MIN_SCORE = 0.86;
const STRONG_SCORE = 0.96;
const cache = new Map();

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  const n = norm(text);
  return n ? n.split(" ") : [];
}

function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// 1 when the word is the same, a typo, or a one-or-two-letter ending ("night"/"nights").
function wordHit(word, hay) {
  let best = 0;
  for (const other of hay) {
    if (word === other) return 1;
    const maxLen = Math.max(word.length, other.length);
    const minLen = Math.min(word.length, other.length);
    if (minLen < 4 || maxLen - minLen > 2) continue;
    if (other.startsWith(word) || word.startsWith(other)) best = Math.max(best, minLen / maxLen);
    best = Math.max(best, 1 - editDistance(word, other) / maxLen);
    if (best >= 0.999) return 1;
  }
  // A distant word of similar length is not a typo.
  return best >= 0.75 ? best : 0;
}

// Each needle consumes one hay word, so "tomorrow and tomorrow" is not the
// same book as "tomorrow and tomorrow and tomorrow".
function coverage(needles, hay) {
  if (!needles.length) return 1;
  const pool = [...hay];
  let sum = 0;
  for (const word of needles) {
    let best = 0;
    let at = -1;
    for (let i = 0; i < pool.length; i += 1) {
      const hit = word === pool[i] ? 1 : wordHit(word, [pool[i]]);
      if (hit > best) {
        best = hit;
        at = i;
      }
    }
    sum += best;
    if (at >= 0 && best >= 0.75) pool.splice(at, 1);
  }
  return sum / needles.length;
}

function harmonic(a, b) {
  if (a + b === 0) return 0;
  return (2 * a * b) / (a + b);
}

function titleVariants(title) {
  const raw = String(title || "");
  const noParen = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  return [raw, noParen, raw.split(/[:|–—]/)[0], noParen.split(/[:|–—]/)[0]];
}

// 1 is the same title. Author words in the query count ("Circe Madeline Miller"
// matches Circe by Madeline Miller) but a different book that merely shares a
// word does not.
export function scoreBook(query, book) {
  const qTokens = tokens(query);
  if (!qTokens.length || !book?.title) return 0;
  let best = 0;
  for (const variant of titleVariants(book.title)) {
    const titleTokens = tokens(variant);
    if (!titleTokens.length) continue;
    const authorTokens = tokens(book.author);
    const recall = coverage(qTokens, titleTokens);
    const precision = coverage(titleTokens, qTokens);
    if (recall >= 0.99 && precision >= 0.99) return 1;
    const f1 = harmonic(recall, precision);
    const extra = qTokens.filter((word) => wordHit(word, titleTokens) < 0.8);
    const extraHit = extra.length ? coverage(extra, authorTokens) : 0;
    const authorBoost = extra.length && extraHit >= 0.8 ? 0.92 + 0.06 * precision : 0;
    best = Math.max(best, f1, authorBoost);
  }
  return best;
}

function cleanIsbn(value) {
  const isbn = String(value || "").replace(/[^0-9Xx]/g, "");
  if (/^[0-9]{13}$/.test(isbn) || /^[0-9]{9}[0-9Xx]$/.test(isbn)) return isbn.toUpperCase();
  return null;
}

function isbnCover(isbn) {
  return isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg` : null;
}

function canonicalTitle(title) {
  const noParen = String(title || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  return norm(noParen.split(/[:|–—]/)[0]);
}

function dedupeKey(book) {
  const author = tokens(book.author);
  return `${canonicalTitle(book.title)}|${author[author.length - 1] || ""}`;
}

// Highest-scoring distinct books. Ones with an Open Library cover id win ties,
// then any cover, then the edition with the most printings.
export function rankMatches(query, books, limit = 5) {
  let scored = [];
  for (const book of books) {
    if (!book?.title) continue;
    const score = scoreBook(query, book);
    if (score < MIN_SCORE) continue;
    scored.push({ ...book, score, order: book.order ?? scored.length });
  }
  // An exact hit is enough: don't also show "Atomic Habit" for "Atomic Habits".
  const top = scored.reduce((best, book) => Math.max(best, book.score), 0);
  if (top >= 0.99) scored = scored.filter((book) => book.score >= 0.97);
  const byKey = new Map();
  for (const book of scored) {
    const key = dedupeKey(book);
    const prev = byKey.get(key);
    if (!prev || prefer(book, prev)) byKey.set(key, book);
  }
  let list = [...byKey.values()];
  const titled = new Set(list.filter((book) => book.author).map((book) => norm(book.title)));
  list = list.filter((book) => book.author || !titled.has(norm(book.title)));
  // A one-off catalog copy loses to the edition that has actually been printed.
  list = list.filter((book) => {
    const title = canonicalTitle(book.title);
    const copies = Math.max(book.editions || 0, 1);
    return !list.some((other) => other !== book && canonicalTitle(other.title) === title && (other.editions || 0) >= 8 && (other.editions || 0) >= copies * 8);
  });
  list.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.02) return diff;
    return (b.coverId ? 1 : 0) - (a.coverId ? 1 : 0) || (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || (a.order ?? 999) - (b.order ?? 999);
  });
  return list.slice(0, limit).map((book) => ({
    key: book.key || null,
    title: book.title,
    author: book.author || null,
    year: book.year || null,
    cover: book.cover || null,
  }));
}

function prefer(a, b) {
  if (Boolean(a.coverId) !== Boolean(b.coverId)) return Boolean(a.coverId);
  if (Boolean(a.cover) !== Boolean(b.cover)) return Boolean(a.cover);
  if ((a.editions || 0) !== (b.editions || 0)) return (a.editions || 0) > (b.editions || 0);
  if (Boolean(a.author) !== Boolean(b.author)) return Boolean(a.author);
  return (a.order ?? 999) <= (b.order ?? 999);
}

function fromOl(doc) {
  const isbn = (doc.isbn || []).map(cleanIsbn).find(Boolean) || null;
  const coverId = doc.cover_i || null;
  return {
    key: doc.key || null,
    title: doc.title,
    author: doc.author_name?.[0] || null,
    year: doc.first_publish_year || null,
    cover: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : isbnCover(isbn),
    coverId,
    editions: doc.edition_count || 0,
  };
}

function googleCover(links) {
  const raw = links?.thumbnail || links?.smallThumbnail;
  if (!raw) return null;
  return raw.replace(/^http:/, "https:").replace(/&edge=curl/, "");
}

function fromGoogle(item) {
  const info = item.volumeInfo || {};
  const ids = info.industryIdentifiers || [];
  const isbn13 = ids.find((id) => id.type === "ISBN_13");
  const isbn10 = ids.find((id) => id.type === "ISBN_10");
  const isbn = cleanIsbn(isbn13?.identifier) || cleanIsbn(isbn10?.identifier);
  return {
    key: item.id ? `gb:${item.id}` : null,
    title: info.title,
    author: info.authors?.[0] || null,
    year: Number.parseInt(info.publishedDate, 10) || null,
    cover: googleCover(info.imageLinks) || isbnCover(isbn),
    coverId: null,
    editions: 0,
  };
}

function abortError() {
  return new DOMException("aborted", "AbortError");
}

async function load(url, signal, ms) {
  if (signal?.aborted) throw abortError();
  if (ms <= 0) {
    const error = new Error("lookup timed out");
    error.name = "TimeoutError";
    throw error;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (signal?.aborted) throw abortError();
    if (!res.ok) throw new Error(`lookup ${res.status}`);
    return await res.json();
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error?.name === "AbortError" || ctl.signal.aborted) {
      const timeout = new Error("lookup timed out");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function openLibrary(params, signal, ms) {
  const url = new URL(OL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("limit", "15");
  url.searchParams.set("fields", OL_FIELDS);
  const data = await load(url, signal, ms);
  return (data.docs || []).map(fromOl);
}

async function googleBooks(q, signal, ms) {
  const url = new URL(GB);
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "8");
  url.searchParams.set("printType", "books");
  url.searchParams.set("fields", "items(id,volumeInfo(title,authors,imageLinks,publishedDate,industryIdentifiers))");
  const data = await load(url, signal, ms);
  return (data.items || []).map(fromGoogle);
}

function isStrong(query, books) {
  return books.some((book) => scoreBook(query, book) >= STRONG_SCORE && book.cover);
}

// "Forth Wing" → "fourth wing", then a normal title search. The suggestion is
// not shown on its own; it still has to match what was typed.
async function spelledBooks(q, signal, left) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", q);
  url.searchParams.set("srlimit", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const data = await load(url, signal, left());
  const suggestion = data?.query?.searchinfo?.suggestion?.trim().replace(/\s+/g, " ") || "";
  let title = suggestion && suggestion.toLowerCase() !== q.toLowerCase() ? suggestion : "";
  if (!title) {
    const top = data?.query?.search?.[0]?.title?.trim();
    if (top && scoreBook(q, { title: top }) >= MIN_SCORE) title = top;
  }
  if (!title) return [];
  return openLibrary({ title }, signal, left());
}

export function thumb(url) {
  if (!url) return null;
  return url.replace(/-L\.jpg$/, "-M.jpg");
}

// Up to `limit` books whose titles (and, when the query includes it, the
// author) actually match. Throws if every source fails, so the caller can
// still offer the typed title.
export async function searchBooks(query, { signal, limit = 5, timeout = 10000 } = {}) {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const key = `${q.toLowerCase()}|${limit}`;
  if (cache.has(key)) return cache.get(key);

  const started = Date.now();
  const left = () => timeout - (Date.now() - started);
  // A slow title search must not eat the whole budget and skip the fallbacks.
  const fallbackMs = () => Math.max(left(), Math.min(5000, timeout));
  let primary = [];
  let primaryFailed = false;
  try {
    primary = await openLibrary({ title: q }, signal, left());
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    primaryFailed = true;
  }

  let ranked = rankMatches(q, primary, limit);
  // A confident covered hit from the title index is enough.
  if (!isStrong(q, ranked)) {
    const [loose, gb, spelled] = await Promise.allSettled([
      openLibrary({ q }, signal, fallbackMs()),
      googleBooks(q, signal, fallbackMs()),
      spelledBooks(q, signal, fallbackMs),
    ]);
    if (signal?.aborted) throw abortError();
    const more = [];
    let failures = primaryFailed ? 1 : 0;
    for (const result of [loose, gb, spelled]) {
      if (result.status === "fulfilled") more.push(...result.value);
      else if (result.reason?.name === "AbortError") throw result.reason;
    }
    if (loose.status === "rejected") failures += 1;
    if (gb.status === "rejected") failures += 1;
    ranked = rankMatches(q, [...primary, ...more], limit);
    // Spelling help is optional. Throw only when the catalogs themselves failed.
    if (!ranked.length && failures === 3) throw loose.reason || gb.reason || new Error("lookup failed");
  }

  cache.set(key, ranked);
  return ranked;
}
