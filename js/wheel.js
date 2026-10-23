// The circle of covers, with the spinner on her chair in the middle.
// Only the spinner moves; each frame writes one transform on one element.
import { spinnerSVG } from "./spinner.js";
import { drawnCoverSVG } from "./drawn.js";

const NS = "http://www.w3.org/2000/svg";
const R = 284;
const COVER_W = 90;
const COVER_H = 135;
const COVER_TOP = 272;
const RUG = 132;
const TINTS = ["#ecd3b4", "#c9d6b9", "#ecc5c1", "#cdd8e2", "#f0dca6", "#dccfe4"];

const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
};

function wedge(n, i) {
  if (n === 1) return `M0 ${-R} A${R} ${R} 0 1 1 0 ${R} A${R} ${R} 0 1 1 0 ${-R} Z`;
  const step = 360 / n;
  const [x0, y0] = polar(R, (i - 0.5) * step);
  const [x1, y1] = polar(R, (i + 0.5) * step);
  return `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${step > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function faceSVG(picks, uid) {
  const n = picks.length;
  const step = n ? 360 / n : 60;
  const segs = picks
    .map((pick, i) => {
      const angle = i * step;
      const x = -COVER_W / 2;
      const y = -COVER_TOP;
      const cover = pick.cover_url
        ? `<image class="seg-img" href="${esc(pick.cover_url)}" x="${x}" y="${y}" width="${COVER_W}" height="${COVER_H}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${uid}-cv)"/>`
        : "";
      return `<g class="seg" data-i="${i}">
        <path class="seg-bg" d="${wedge(n, i)}" fill="${TINTS[i % TINTS.length]}"/>
        <g transform="rotate(${angle})">
          <rect x="${x + 3}" y="${y + 5}" width="${COVER_W}" height="${COVER_H}" rx="5" fill="#3a2418" opacity=".18"/>
          <g class="seg-drawn"${pick.cover_url ? " hidden" : ""}>${drawnCoverSVG(pick, { x, y, w: COVER_W, h: COVER_H })}</g>
          ${cover}
          <rect x="${x}" y="${y}" width="${COVER_W}" height="${COVER_H}" rx="5" fill="none" stroke="#2d2421" stroke-opacity=".12"/>
        </g>
      </g>`;
    })
    .join("");

  const lines =
    n > 1
      ? picks
          .map((_, i) => {
            const [x, y] = polar(R, (i - 0.5) * step);
            return `<path d="M0 0 L${x.toFixed(2)} ${y.toFixed(2)}"/>`;
          })
          .join("")
      : "";

  const empty = !n
    ? Array.from({ length: 6 }, (_, i) => {
        const angle = i * 60;
        return `<g transform="rotate(${angle})"><rect x="${-COVER_W / 2}" y="${-COVER_TOP}" width="${COVER_W}" height="${COVER_H}" rx="6" class="slot"/></g>`;
      }).join("")
    : "";

  const winnerRing = n
    ? `<path class="seg-glow" d="" fill="none" stroke="#f3c24f" stroke-width="10" stroke-linejoin="round"/>`
    : "";

  const ticks = Array.from({ length: 72 }, (_, i) => {
    const [x0, y0] = polar(R + 5, i * 5);
    const [x1, y1] = polar(R + (i % 2 ? 9 : 12), i * 5);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }).join(" ");

  return `<svg class="wheel-face" viewBox="-300 -300 600 600" xmlns="${NS}" aria-hidden="true">
    <defs>
      <clipPath id="${uid}-cv"><rect x="${-COVER_W / 2}" y="${-COVER_TOP}" width="${COVER_W}" height="${COVER_H}" rx="5"/></clipPath>
      <radialGradient id="${uid}-rug" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#fbf6ea"/>
        <stop offset="1" stop-color="#f1e6cf"/>
      </radialGradient>
    </defs>
    <circle r="${R + 14}" fill="#fbf6ea"/>
    <path d="${ticks}" stroke="#2d2421" stroke-opacity=".28" stroke-width="1.6" stroke-linecap="round"/>
    <circle r="${R}" fill="${n ? "#efe4cd" : "#f3ead6"}"/>
    ${segs}${empty}
    <g class="seg-lines" stroke="#fbf6ea" stroke-width="5" stroke-linecap="round">${lines}</g>
    ${winnerRing}
    <circle r="${R}" fill="none" stroke="#2d2421" stroke-width="3"/>
    <circle r="${RUG}" fill="url(#${uid}-rug)" stroke="#2d2421" stroke-width="3"/>
    <circle r="${RUG - 12}" fill="none" stroke="#c98c90" stroke-width="2.4" stroke-dasharray="1 8" stroke-linecap="round"/>
    <circle r="${RUG - 24}" fill="none" stroke="#7f9a7a" stroke-opacity=".45" stroke-width="1.4"/>
  </svg>`;
}

let count = 0;

export function createWheel(host, { picks = [], spinner = {} } = {}) {
  const uid = `wh${(count += 1)}`;
  host.innerHTML = `<div class="wheel" data-n="${picks.length}">
    ${faceSVG(picks, uid)}
    <div class="wheel-hub">
      <div class="spin-rot">
        <svg class="swoosh" viewBox="-112 -112 224 224" aria-hidden="true">
          <path d="M-36 -100 A106 106 0 0 0 -88 -58" />
          <path d="M-22 -92 A95 95 0 0 0 -70 -60" />
          <path d="M44 92 A100 100 0 0 0 84 54" />
        </svg>
        ${spinnerSVG(spinner)}
      </div>
    </div>
  </div>`;
  const root = host.firstElementChild;
  const rot = root.querySelector(".spin-rot");
  const step = picks.length ? 360 / picks.length : 60;
  let angle = 0;
  let frame = 0;

  // Missing or broken covers fall back to the drawn one.
  root.querySelectorAll(".seg").forEach((seg) => {
    const img = seg.querySelector(".seg-img");
    if (!img) return;
    img.addEventListener("error", () => {
      img.remove();
      seg.querySelector(".seg-drawn").removeAttribute("hidden");
    });
  });

  const set = (deg) => {
    angle = deg;
    rot.style.transform = `rotate(${deg.toFixed(3)}deg)`;
  };

  const markWinner = (index) => {
    const glow = root.querySelector(".seg-glow");
    if (glow) glow.setAttribute("d", wedge(picks.length, index));
    root.querySelectorAll(".seg").forEach((seg) => seg.classList.toggle("is-winner", Number(seg.dataset.i) === index));
    root.classList.add("is-done");
  };

  // Every phone draws the same spin from the round's seed: turns and where
  // inside the slice her hands land.
  const plan = (index, seed) => {
    const s = Math.abs(Number(seed) || 0);
    const turns = 5 + (s % 3);
    const jitter = (((Math.floor(s / 7) % 1000) / 1000) - 0.5) * step * 0.5;
    return { final: index * step + jitter, total: index * step + jitter + 360 * turns };
  };

  const setMode = (mode) => {
    if (root.dataset.mode !== mode) root.dataset.mode = mode;
  };

  return {
    root,
    pointAt(index, seed) {
      cancelAnimationFrame(frame);
      set(plan(index, seed).final);
      setMode("rest");
      markWinner(index);
    },
    idle() {
      setMode("idle");
    },
    spin(index, seed, { reduced = false } = {}) {
      cancelAnimationFrame(frame);
      root.classList.remove("is-done");
      root.querySelectorAll(".seg.is-winner").forEach((seg) => seg.classList.remove("is-winner"));
      const { total, final } = plan(index, seed);
      const windup = reduced ? 0 : 520;
      const run = reduced ? 1400 : 6400;
      const rock = reduced ? 0 : 900;
      const back = -22;
      const k = 3.2;
      set(0);
      setMode("windup");
      return new Promise((resolve) => {
        const t0 = performance.now();
        let last = t0;
        let lastAngle = 0;
        const tick = (now) => {
          const t = now - t0;
          let a;
          if (t < windup) {
            const u = t / windup;
            a = back * (0.5 - 0.5 * Math.cos(Math.PI * u));
          } else if (t < windup + run) {
            const u = (t - windup) / run;
            a = back + (total - back) * (1 - (1 - u) ** k);
          } else if (t < windup + run + rock) {
            const u = (t - windup - run) / rock;
            a = total + 7 * Math.sin(2 * Math.PI * 1.25 * u) * (1 - u) ** 2;
          } else {
            set(final);
            setMode("rest");
            markWinner(index);
            resolve();
            return;
          }
          set(a);
          const speed = Math.abs(a - lastAngle) / Math.max(1, now - last);
          last = now;
          lastAngle = a;
          if (t >= windup) setMode(speed > 0.55 ? "fast" : speed > 0.06 ? "slow" : "rock");
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      });
    },
    get angle() {
      return angle;
    },
    destroy() {
      cancelAnimationFrame(frame);
    },
  };
}
