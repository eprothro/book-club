// Ranking and timeout for cover search. No database.
//   node tools/covers.mjs
//   BOOKCLUB_LIVE=1 node tools/covers.mjs   (also queries Open Library and Google Books)
import assert from "node:assert/strict";
import { rankMatches, scoreBook, searchBooks } from "../js/covers.js";

function titles(query, books) {
  return rankMatches(query, books).map((book) => book.title);
}

const fourthWing = [
  { title: "Fourth Wing", author: "Rebecca Yarros", cover: "https://covers.openlibrary.org/b/id/1-L.jpg", coverId: 1, editions: 15 },
  { title: "Fourth Wing", author: "Entangled", cover: "https://covers.openlibrary.org/b/isbn/999-L.jpg", editions: 1 },
  { title: "Fourth Wing", author: "Out of Print", cover: "https://covers.openlibrary.org/b/isbn/998-L.jpg", editions: 1 },
  { title: "Onyx Storm", author: "Rebecca Yarros", cover: "https://covers.openlibrary.org/b/id/2-L.jpg", coverId: 2, editions: 4 },
  { title: "House of Marionne", author: "J. Elle", cover: "https://covers.openlibrary.org/b/id/3-L.jpg", coverId: 3 },
  { title: "Fourth Wing (The Empyrean Book 1)", author: "Rebecca Yarros", cover: null },
  { title: "Fourth Wing Tarot", author: "Rebecca Yarros", cover: null },
  { title: "Empyrean Series, 3 Books Collection Set, Fourth Wing, Iron Flame, Onyx Storm", author: "Rebecca Yarros", cover: "https://covers.openlibrary.org/b/id/4-L.jpg", coverId: 4 },
];

assert.deepEqual(titles("Fourth Wing", fourthWing), ["Fourth Wing"]);
assert.ok(scoreBook("Fourth Wing", fourthWing.find((book) => book.title === "Onyx Storm")) < 0.4, "Onyx Storm is unrelated");
assert.ok(scoreBook("Forth Wing", fourthWing[0]) >= 0.86, "one-letter typo still matches");
assert.equal(titles("Forth Wing", fourthWing)[0], "Fourth Wing");

const hugo = [
  { title: "The Seven Husbands of Evelyn Hugo", author: "Taylor Jenkins Reid", cover: "https://covers.openlibrary.org/b/id/5-L.jpg", coverId: 5, editions: 20 },
  { title: "The Three Lives of Cate Kay", author: "Kate Fagan", cover: "https://covers.openlibrary.org/b/id/6-L.jpg", coverId: 6 },
  { title: "Summary of the Seven Husbands of Evelyn Hugo by Taylor Jenkins Reid", author: "Antoine McCallan", cover: null },
  { title: "The Conspirators Hierarchy", author: "John Coleman", cover: "https://covers.openlibrary.org/b/id/7-L.jpg", coverId: 7 },
];
assert.deepEqual(titles("The Seven Husbands of Evelyn Hugo", hugo), ["The Seven Husbands of Evelyn Hugo"]);
assert.ok(scoreBook("The Seven Husbands of Evelyn Hugo", { title: "Les Sept Maris d'Evelyn Hugo" }) < 0.86, "a translation that only shares the name stays out");

const crawdads = [
  { title: "Where the Crawdads Sing", author: "Delia Owens", cover: "https://covers.openlibrary.org/b/id/8-L.jpg", coverId: 8, editions: 12 },
  { title: "Educated", author: "Tara Westover", cover: "https://covers.openlibrary.org/b/id/9-L.jpg", coverId: 9, editions: 30 },
  { title: "Where the Crawdads Sing Everywhere", author: "Azzedine Djeha", cover: null },
];
assert.deepEqual(titles("Where the Crawdads Sing", crawdads), ["Where the Crawdads Sing"]);
assert.ok(scoreBook("Where the Crawdad Sing", crawdads[0]) >= 0.86, "missing s still matches");

const habits = [
  { title: "Atomic Habits", author: "James Clear", cover: "https://covers.openlibrary.org/b/id/10-L.jpg", coverId: 10, editions: 40 },
  { title: "Atomic Habits", author: "Phil GRAHAM", cover: null, editions: 1 },
  { title: "Atomic Habit", author: "Nelson Singleton", cover: "https://covers.openlibrary.org/b/id/99-L.jpg", coverId: 99, editions: 1 },
  { title: "Atomic Habits Journal", author: "Atomic Habit Journal", cover: "https://covers.openlibrary.org/b/id/11-L.jpg", coverId: 11 },
  { title: "Companion Workbook : Atomic Habits", author: "Julie Ann Price", cover: "https://covers.openlibrary.org/b/id/12-L.jpg", coverId: 12 },
  { title: "Summary of Atomic Habits by James Clear", author: "James C. Scott", cover: "https://covers.openlibrary.org/b/id/13-L.jpg", coverId: 13 },
];
assert.deepEqual(titles("Atomic Habits", habits), ["Atomic Habits"]);
assert.equal(titles("Atomic Habbits", habits)[0], "Atomic Habits");
assert.equal(titles("Atomic Habits", habits)[0], "Atomic Habits");
assert.equal(rankMatches("Atomic Habits", habits)[0].author, "James Clear", "covered edition wins the tie");

assert.equal(scoreBook("circe madeline miller", { title: "Circe", author: "Madeline Miller" }) >= 0.96, true);
assert.ok(scoreBook("circe madeline miller", { title: "Galatea", author: "Madeline Miller" }) < 0.86);
assert.deepEqual(titles("circe madeline miller", [
  { title: "Circe", author: "Madeline Miller", cover: "https://covers.openlibrary.org/b/id/14-L.jpg", coverId: 14 },
  { title: "Galatea", author: "Madeline Miller", cover: "https://covers.openlibrary.org/b/id/15-L.jpg", coverId: 15 },
  { title: "Summary of Circe by Madeline Miller", author: "BookHabits", cover: null },
  { title: "Study Guide The Personal Librarian", author: "SuperSummary", cover: "https://covers.openlibrary.org/b/id/16-L.jpg", coverId: 16 },
]), ["Circe"]);

const secret = [
  { title: "The Secret History", author: "Donna Tartt", cover: "https://covers.openlibrary.org/b/id/17-L.jpg", coverId: 17, editions: 50 },
  { title: "The Secret History", author: "Procopius", cover: "https://covers.openlibrary.org/b/id/18-L.jpg", coverId: 18, editions: 8 },
  { title: "The Secret History of Wonder Woman", author: "Jill Lepore", cover: "https://covers.openlibrary.org/b/id/19-L.jpg", coverId: 19 },
  { title: "Empire of Pain", author: "Patrick Radden Keefe", cover: "https://covers.openlibrary.org/b/id/20-L.jpg", coverId: 20 },
];
assert.deepEqual(titles("the secret history", secret), ["The Secret History", "The Secret History"]);
assert.equal(rankMatches("the secret history", secret)[0].author, "Donna Tartt");

assert.ok(scoreBook("tomorrow and tomorrow and tomorrow", { title: "Tomorrow and Tomorrow" }) < 0.86);
assert.equal(scoreBook("tomorrow and tomorrow and tomorrow", { title: "Tomorrow, and Tomorrow, and Tomorrow" }), 1);
assert.equal(scoreBook("the night circus", { title: "The Night Circus", author: "Erin Morgenstern" }), 1);
assert.ok(scoreBook("the night circus", { title: "Nights at the Circus", author: "Angela Carter" }) < 0.86);
assert.ok(scoreBook("the night circus", { title: "Educated", author: "Tara Westover" }) < 0.2);

assert.equal(scoreBook("Les Misérables", { title: "Les Miserables", author: "Victor Hugo" }), 1);
assert.equal(scoreBook("les miserables", { title: "Les Misérables", author: "Victor Hugo" }), 1);
assert.deepEqual(titles("zzqx vworp blint", fourthWing.concat(hugo, crawdads)), []);

assert.equal(scoreBook("Handmaid's Tale", { title: "The Handmaid's Tale" }), 1);

// A hung catalog must give up, so the typed title can still be used.
const originalFetch = globalThis.fetch;
globalThis.fetch = (_url, { signal } = {}) =>
  new Promise((_, reject) => {
    const error = new Error("aborted");
    error.name = "AbortError";
    if (signal?.aborted) reject(error);
    else signal?.addEventListener("abort", () => reject(error));
  });
const started = Date.now();
await assert.rejects(() => searchBooks("quota timeout probe", { timeout: 400 }), /timed out|lookup/);
const elapsed = Date.now() - started;
assert.ok(elapsed >= 350 && elapsed < 2000, `timeout budget held (${elapsed}ms)`);
globalThis.fetch = originalFetch;

console.log("ok cover ranking and timeout");

if (process.env.BOOKCLUB_LIVE) {
  const queries = [
    "Fourth Wing",
    "The Seven Husbands of Evelyn Hugo",
    "Where the Crawdads Sing",
    "Atomic Habits",
    "Forth Wing",
    "zzqx vworp blint",
  ];
  for (const query of queries) {
    const t = Date.now();
    try {
      const books = await searchBooks(query, { timeout: 12000 });
      console.log(`\n${query} (${Date.now() - t}ms)`);
      if (!books.length) console.log("  (no catalog match)");
      for (const book of books) console.log(`  ${book.cover ? "cover" : "plain"}  ${book.title} — ${book.author || ""}`);
    } catch (error) {
      console.log(`\n${query} FAILED ${error.name}: ${error.message}`);
    }
  }
}
