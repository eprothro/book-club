// Book lookup with real covers. Open Library and Google Books, no keys.
// Either service can be down or over quota; the other one still answers.

const OL = "https://openlibrary.org/search.json";
const GB = "https://www.googleapis.com/books/v1/volumes";
const cache = new Map();

function norm(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(":")[0]
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lastName(author) {
  return norm(author).split(" ").pop() || "";
}

async function openLibrary(q, signal) {
  const url = `${OL}?q=${encodeURIComponent(q)}&limit=12&fields=key,title,author_name,cover_i,first_publish_year`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`openlibrary ${res.status}`);
  const data = await res.json();
  return (data.docs || []).map((doc) => ({
    key: doc.key || null,
    title: doc.title,
    author: doc.author_name?.[0] || null,
    year: doc.first_publish_year || null,
    cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
  }));
}

function googleCover(links) {
  const raw = links?.thumbnail || links?.smallThumbnail;
  if (!raw) return null;
  return raw.replace(/^http:/, "https:").replace(/&edge=curl/, "");
}

async function googleBooks(q, signal) {
  const url = `${GB}?q=${encodeURIComponent(q)}&maxResults=10&printType=books&fields=items(id,volumeInfo(title,authors,imageLinks,publishedDate))`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`googlebooks ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((item) => ({
    key: `gb:${item.id}`,
    title: item.volumeInfo?.title,
    author: item.volumeInfo?.authors?.[0] || null,
    year: Number.parseInt(item.volumeInfo?.publishedDate, 10) || null,
    cover: googleCover(item.volumeInfo?.imageLinks),
  }));
}

export function thumb(url) {
  if (!url) return null;
  return url.replace(/-L\.jpg$/, "-M.jpg");
}

// Up to `limit` distinct books, ones with covers first, alternating sources
// so a strong match from either one stays near the top.
export async function searchBooks(query, { signal, limit = 5 } = {}) {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const [ol, gb] = await Promise.allSettled([openLibrary(q, signal), googleBooks(q, signal)]);
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (ol.status === "rejected" && gb.status === "rejected") throw ol.reason;

  const a = ol.status === "fulfilled" ? ol.value : [];
  const b = gb.status === "fulfilled" ? gb.value : [];
  const merged = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i]) merged.push(a[i]);
    if (b[i]) merged.push(b[i]);
  }

  const seen = new Set();
  const books = [];
  for (const book of merged) {
    if (!book.title) continue;
    const id = `${norm(book.title)}|${lastName(book.author)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    books.push(book);
  }
  const ranked = [...books.filter((b) => b.cover), ...books.filter((b) => !b.cover)].slice(0, limit);
  cache.set(key, ranked);
  return ranked;
}
