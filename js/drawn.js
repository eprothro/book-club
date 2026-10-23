// A typeset cover for books with no cover art: cloth color, a rule, the title.
const CLOTH = [
  ["#7d2e3a", "#f6e7cf"],
  ["#2f4a3d", "#f1e3c2"],
  ["#34456b", "#f3e6cc"],
  ["#b5793a", "#fff4de"],
  ["#5b4a6e", "#f4e8d4"],
  ["#8c5a46", "#fbefd9"],
];

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text || "")) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

export function cloth(title) {
  return CLOTH[hash(title) % CLOTH.length];
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function wrap(text, width, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s,.;:]+$/, "").slice(0, width - 1)}…`;
    return kept;
  }
  return lines.map((l) => (l.length > width + 2 ? `${l.slice(0, width)}…` : l));
}

export function drawnCoverSVG(book, { x, y, w, h }) {
  const [bg, fg] = cloth(book.title);
  const lines = wrap(book.title, 10, 4);
  const size = lines.some((l) => l.length > 8) ? 13 : 15;
  const top = y + h * 0.3;
  const text = lines
    .map((l, i) => `<tspan x="${x + w / 2}" y="${top + i * size * 1.15}">${esc(l)}</tspan>`)
    .join("");
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${bg}"/>
    <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" rx="2" fill="none" stroke="${fg}" stroke-opacity=".55" stroke-width="1"/>
    <text font-family="Fraunces, Georgia, serif" font-weight="600" font-size="${size}" fill="${fg}" text-anchor="middle">${text}</text>
    <path d="M${x + w / 2 - 12} ${y + h - 30} h24" stroke="${fg}" stroke-opacity=".7" stroke-width="1.2"/>
    ${book.author ? `<text x="${x + w / 2}" y="${y + h - 16}" font-family="Outfit, sans-serif" font-size="8" letter-spacing=".6" fill="${fg}" fill-opacity=".85" text-anchor="middle">${esc(wrap(book.author.toUpperCase(), 16, 1)[0])}</text>` : ""}`;
}

// The same cover as HTML, for lists and the reveal.
export function drawnCoverHTML(book) {
  const [bg, fg] = cloth(book.title);
  const el = document.createElement("span");
  el.className = "drawn";
  el.style.setProperty("--cloth", bg);
  el.style.setProperty("--foil", fg);
  const title = document.createElement("span");
  title.className = "drawn-title";
  title.textContent = book.title;
  el.append(title);
  if (book.author) {
    const by = document.createElement("span");
    by.className = "drawn-author";
    by.textContent = book.author;
    el.append(by);
  }
  return el;
}
