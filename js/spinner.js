// The spinner: a club member planking face-down on a rolling office chair,
// arms out front with hands together, seen from above. Everything she looks
// like comes from one config object, so another member can take a turn by
// changing a few colors in js/config.js.
//
// Local frame: her hands point to -y (north). The chair hub is at 0,0.
// She fits inside a radius of about 108 units.

const DEFAULTS = {
  hair: "#eccb80",
  roots: "#8a6338",
  hairLength: "shoulder", // "short" | "shoulder" | "long"
  skin: "#f5cdae",
  cheeks: "#f0928f",
  eyes: "#3a2a24",
  top: "#d9a3a5",
  pants: "#4c6290",
  shoes: "#fbf7ef",
  chair: "#33343b",
  earrings: "#e1b04a",
  glasses: null,
};

function hex(c) {
  const v = c.replace("#", "");
  const n = parseInt(v.length === 3 ? v.replace(/(.)/g, "$1$1") : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  const x = hex(a);
  const y = hex(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

const shade = (c, t = 0.18) => mix(c, "#2a1a14", t);
const light = (c, t = 0.35) => mix(c, "#ffffff", t);

let uid = 0;

function hairPaths(length) {
  // Seen from above with her head lifted: the hair frames her face and falls
  // back over her shoulders (+y), in loose waves that flip out at the ends.
  const e = { short: -40, shoulder: -22, long: -4 }[length] ?? -22;
  const back = `M0 -74
    C -18 -74 -27 -64 -27 -51
    C -27 -46 -31 -42 -29 -37
    C -27 -32 -32 -28 -30 ${e + 4}
    C -29 ${e - 1} -34 ${e - 3} -33 ${e - 6}
    C -29 ${e - 4} -27 ${e + 2} -22 ${e}
    C -20 ${e + 4} -15 ${e + 4} -14 ${e - 1}
    C -13 -30 -7 -40 0 -40
    C 7 -40 13 -30 14 ${e - 1}
    C 15 ${e + 4} 20 ${e + 4} 22 ${e}
    C 27 ${e + 2} 29 ${e - 4} 33 ${e - 6}
    C 34 ${e - 3} 29 ${e - 1} 30 ${e + 4}
    C 32 -28 27 -32 29 -37
    C 31 -42 27 -46 27 -51
    C 27 -64 18 -74 0 -74 Z`;
  const waves = `M-22 -56 C-26 -50 -21 -45 -25 -39 C-28 -34 -23 -30 -26 ${e + 3}
    M-17 -48 C-20 -42 -16 -38 -19 -32 C-21 -28 -17 ${e + 4} -18 ${e + 1}
    M22 -56 C26 -50 21 -45 25 -39 C28 -34 23 -30 26 ${e + 3}
    M17 -48 C20 -42 16 -38 19 -32 C21 -28 17 ${e + 4} 18 ${e + 1}`;
  const shine = `M-24.5 -52 C-27 -47 -24 -43 -27 -38 M24.5 -52 C27 -47 24 -43 27 -38
    M-20 -38 C-22 -33 -19 -29 -22 ${e + 5} M20 -38 C22 -33 19 -29 22 ${e + 5}`;
  return { back, waves, shine, end: e };
}

export function spinnerSVG(config = {}) {
  const c = { ...DEFAULTS, ...config };
  const id = `sp${(uid += 1)}`;
  const hair = hairPaths(c.hairLength);
  const topS = shade(c.top, 0.16);
  const topD = shade(c.top, 0.3);
  const pantsS = shade(c.pants, 0.25);
  const skinS = shade(c.skin, 0.14);
  const hairS = shade(c.hair, 0.2);
  const hairL = light(c.hair, 0.4);
  const chairL = light(c.chair, 0.22);

  const spokes = [0, 72, 144, 216, 288]
    .map((a) => `<g transform="rotate(${a + 36})"><rect x="-3.6" y="0" width="7.2" height="47" rx="3.6" fill="${c.chair}"/><rect x="-1.2" y="8" width="2.4" height="36" rx="1.2" fill="${chairL}" opacity=".45"/><rect x="-5.5" y="43" width="11" height="8" rx="3.5" fill="#17171b"/><rect x="-3.5" y="44.5" width="7" height="2.4" rx="1.2" fill="#4a4b53"/></g>`)
    .join("");

  const glasses = c.glasses
    ? `<g fill="none" stroke="${c.glasses}" stroke-width="1.3"><circle cx="-5.6" cy="-49.5" r="4.4"/><circle cx="5.6" cy="-49.5" r="4.4"/><path d="M-1.2 -50 Q0 -51.2 1.2 -50"/></g>`
    : "";

  return `<svg class="spinner-svg" viewBox="-112 -112 224 224" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="${id}-roots" cx="0.56" cy="0.04" r="0.66">
      <stop offset="0" stop-color="${c.roots}"/>
      <stop offset="0.2" stop-color="${c.roots}"/>
      <stop offset="0.42" stop-color="${mix(c.roots, c.hair, 0.55)}"/>
      <stop offset="0.62" stop-color="${c.hair}"/>
      <stop offset="1" stop-color="${hairS}"/>
    </radialGradient>
    <linearGradient id="${id}-top" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${topS}"/>
      <stop offset="0.45" stop-color="${c.top}"/>
      <stop offset="1" stop-color="${topS}"/>
    </linearGradient>
    <linearGradient id="${id}-jeans" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${pantsS}"/>
      <stop offset="0.5" stop-color="${c.pants}"/>
      <stop offset="1" stop-color="${pantsS}"/>
    </linearGradient>
    <radialGradient id="${id}-seat" cx="0.4" cy="0.35" r="0.7">
      <stop offset="0" stop-color="${chairL}"/>
      <stop offset="1" stop-color="${c.chair}"/>
    </radialGradient>
  </defs>

  <g class="sp-chair">
    <circle r="54" fill="#6b4a2f" opacity=".09"/><circle r="44" fill="#6b4a2f" opacity=".05"/>
    ${spokes}
    <circle r="9" fill="#202126"/>
    <ellipse cx="0" cy="4" rx="31" ry="28" fill="url(#${id}-seat)"/>
    <ellipse cx="0" cy="4" rx="31" ry="28" fill="none" stroke="#15151a" stroke-width="1.6" opacity=".55"/>
  </g>

  <g class="sp-legs">
    <path d="M-20 14 C-21 40 -18 62 -17 80 L-7.5 80 C-6.5 62 -4.5 40 -2 14 Z" fill="url(#${id}-jeans)"/>
    <path d="M20 14 C21 40 18 62 17 80 L7.5 80 C6.5 62 4.5 40 2 14 Z" fill="url(#${id}-jeans)"/>
    <path d="M-11.5 40 L-12 78 M11.5 40 L12 78" stroke="${pantsS}" stroke-width=".9" opacity=".8"/>
    <path d="M-17 76 L-7.5 76 M17 76 L7.5 76" stroke="${light(c.pants, 0.3)}" stroke-width="1.6" opacity=".55"/>
    <g class="sp-feet">
      <rect x="-17.5" y="79" width="10.5" height="4" rx="1.5" fill="#fffaf2"/>
      <rect x="7" y="79" width="10.5" height="4" rx="1.5" fill="#fffaf2"/>
      <ellipse cx="-12.5" cy="90" rx="7.4" ry="10" fill="${c.shoes}"/>
      <ellipse cx="12.5" cy="90" rx="7.4" ry="10" fill="${c.shoes}"/>
      <ellipse cx="-12.5" cy="91.5" rx="5" ry="7.5" fill="${mix(c.shoes, "#9a8f86", 0.35)}"/>
      <ellipse cx="12.5" cy="91.5" rx="5" ry="7.5" fill="${mix(c.shoes, "#9a8f86", 0.35)}"/>
      <path d="M-16 89 H-9 M-16 92 H-9 M-16 95 H-9 M9 89 H16 M9 92 H16 M9 95 H16" stroke="${mix(c.shoes, "#6e655e", 0.45)}" stroke-width=".8" opacity=".6"/>
      <path d="M-16.5 82.5 Q-12.5 80 -8.5 82.5 M8.5 82.5 Q12.5 80 16.5 82.5" stroke="${c.top}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    </g>
  </g>

  <g class="sp-hips">
    <path d="M-21 8 C-23 22 -19 31 -9 33 C-4 34 4 34 9 33 C19 31 23 22 21 8 Z" fill="url(#${id}-jeans)"/>
    <path d="M0 18 V33" stroke="${pantsS}" stroke-width="1"/>
    <path d="M-15 20 h9 v7 q-4.5 3 -9 0 Z M6 20 h9 v7 q-4.5 3 -9 0 Z" fill="none" stroke="${pantsS}" stroke-width="1" stroke-dasharray="1.6 1.2"/>
  </g>

  <g class="sp-torso">
    <path d="M-25 -26 C-28 -10 -26 8 -21 21 C-12 24 12 24 21 21 C26 8 28 -10 25 -26 C16 -33 -16 -33 -25 -26 Z" fill="url(#${id}-top)"/>
    <path d="M-21 18 C-12 21.5 12 21.5 21 18 L21.6 23 C12 26.5 -12 26.5 -21.6 23 Z" fill="${topS}"/>
    <path d="M-17 19.6 v4.5 M-11 20.6 v4.6 M-5 21 v4.7 M1 21.1 v4.7 M7 20.9 v4.6 M13 20.3 v4.5 M18 19.3 v4.3" stroke="${topD}" stroke-width=".6" opacity=".5"/>
    <path d="M-12.5 -30.5 C-7 -24.5 7 -24.5 12.5 -30.5" fill="none" stroke="${topS}" stroke-width="4.2" stroke-linecap="round"/>
    <path d="M-9 -28.4 l.6 2 M-5 -26.9 l.3 2 M-1 -26.4 v2 M3 -26.6 l-.2 2 M7 -27.6 l-.5 2 M10.4 -29.4 l-.7 1.8" stroke="${topD}" stroke-width=".55" opacity=".5"/>
    <path d="M-12 -29 C-17 -22 -22 -18 -26 -17 M12 -29 C17 -22 22 -18 26 -17" fill="none" stroke="${topD}" stroke-width=".8" opacity=".35"/>
    <path d="M-14 -6 C-8 -2 -6 6 -9 12 M13 -10 C9 -4 9 3 11 9 M-2 -14 C1 -10 2 -4 0 1" fill="none" stroke="${topD}" stroke-width="1" stroke-linecap="round" opacity=".35"/>
  </g>

  <g class="sp-hair">
    <path d="${hair.back}" fill="url(#${id}-roots)"/>
    <path d="${hair.back}" fill="none" stroke="${hairS}" stroke-width=".8" opacity=".6"/>
    <path d="${hair.waves}" fill="none" stroke="${hairS}" stroke-width="1" stroke-linecap="round" opacity=".55"/>
    <path d="${hair.shine}" fill="none" stroke="${hairL}" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>
  </g>

  <g class="sp-arms">
    <path d="M-24 -21 Q-36 -52 -6.4 -83" fill="none" stroke="url(#${id}-top)" stroke-width="12" stroke-linecap="round"/>
    <path d="M24 -21 Q36 -52 6.4 -83" fill="none" stroke="url(#${id}-top)" stroke-width="12" stroke-linecap="round"/>
    <path d="M-29.5 -26 Q-41 -54 -10 -86" fill="none" stroke="${topD}" stroke-width="1" opacity=".3"/>
    <path d="M29.5 -26 Q41 -54 10 -86" fill="none" stroke="${topD}" stroke-width="1" opacity=".3"/>
    <path d="M-14.6 -75.6 L-5.6 -84.4 M14.6 -75.6 L5.6 -84.4" stroke="${topS}" stroke-width="12.2" stroke-linecap="butt"/>
    <path d="M-16.4 -79.6 L-10.8 -73.6 M-13.4 -82.2 L-7.8 -76.2 M-10.4 -84.8 L-4.8 -78.8 M16.4 -79.6 L10.8 -73.6 M13.4 -82.2 L7.8 -76.2 M10.4 -84.8 L4.8 -78.8" stroke="${topD}" stroke-width=".6" opacity=".45"/>
    <g class="sp-hands">
      <path d="M-7.6 -83 C-8.8 -93 -4.2 -102 0 -108 C4.2 -102 8.8 -93 7.6 -83 C4 -85 -4 -85 -7.6 -83 Z" fill="${c.skin}"/>
      <path d="M0 -86 V-106" stroke="${skinS}" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M-6 -88 C-6.6 -92 -5.2 -95 -3.6 -97 M6 -88 C6.6 -92 5.2 -95 3.6 -97" fill="none" stroke="${skinS}" stroke-width=".9" stroke-linecap="round" opacity=".8"/>
    </g>
  </g>

  <g class="sp-head">
    <path d="M-5.6 -40 V-30.6 Q0 -28.6 5.6 -30.6 V-40 Z" fill="${skinS}"/>
    <ellipse cx="0" cy="-49" rx="14.5" ry="16" fill="${c.skin}"/>
    <path d="M-12.5 -40 C-9 -33 9 -33 12.5 -40 C9 -34.5 -9 -34.5 -12.5 -40 Z" fill="${skinS}" opacity=".35"/>
    <circle cx="-14.6" cy="-46" r="2.6" fill="${c.skin}"/>
    <circle cx="14.6" cy="-46" r="2.6" fill="${c.skin}"/>
    ${c.earrings ? `<circle cx="-15.2" cy="-42.6" r="1.5" fill="${c.earrings}"/><circle cx="15.2" cy="-42.6" r="1.5" fill="${c.earrings}"/>` : ""}

    <g class="sp-face">
      <ellipse cx="-8.6" cy="-43.8" rx="3.6" ry="2.3" fill="${c.cheeks}" opacity=".55"/>
      <ellipse cx="8.6" cy="-43.8" rx="3.6" ry="2.3" fill="${c.cheeks}" opacity=".55"/>
      <path d="M-8.6 -55.2 Q-5.6 -57.4 -2.6 -55.6 M8.6 -55.2 Q5.6 -57.4 2.6 -55.6" fill="none" stroke="${shade(c.roots, 0.05)}" stroke-width="1.2" stroke-linecap="round"/>
      <g class="sp-eyes-open">
        <ellipse cx="-5.6" cy="-50" rx="1.9" ry="2.4" fill="${c.eyes}"/>
        <ellipse cx="5.6" cy="-50" rx="1.9" ry="2.4" fill="${c.eyes}"/>
        <circle cx="-5" cy="-50.8" r=".7" fill="#fff"/>
        <circle cx="6.2" cy="-50.8" r=".7" fill="#fff"/>
        <path d="M-7.9 -51.6 l-1.4 -.9 M7.9 -51.6 l1.4 -.9" stroke="${c.eyes}" stroke-width=".7" stroke-linecap="round"/>
      </g>
      <g class="sp-eyes-glee">
        <path d="M-7.8 -49.6 Q-5.6 -52.6 -3.4 -49.6 M3.4 -49.6 Q5.6 -52.6 7.8 -49.6" fill="none" stroke="${c.eyes}" stroke-width="1.3" stroke-linecap="round"/>
      </g>
      <path d="M-9.8 -48.4 l-1.6 .5 M-9.8 -47 l-1.5 1.1 M9.8 -48.4 l1.6 .5 M9.8 -47 l1.5 1.1" stroke="${skinS}" stroke-width=".6" stroke-linecap="round"/>
      <path d="M-.4 -47.6 Q.9 -45.2 -.8 -44.6" fill="none" stroke="${skinS}" stroke-width=".9" stroke-linecap="round"/>
      <g class="sp-smile">
        <path d="M-8 -41.6 Q0 -30.6 8 -41.6 Q0 -39.6 -8 -41.6 Z" fill="#8c3a3e"/>
        <path d="M-6.6 -40.9 Q0 -39.3 6.6 -40.9 L5.8 -39.4 Q0 -38 -5.8 -39.4 Z" fill="#fffaf4"/>
        <path d="M-3.8 -35.4 Q0 -38.2 3.8 -35.4 Q0 -33.6 -3.8 -35.4 Z" fill="#e3787c"/>
      </g>
      <g class="sp-whee">
        <ellipse cx="0" cy="-38.6" rx="3.6" ry="3.9" fill="#8c3a3e"/>
        <ellipse cx="0" cy="-37.3" rx="2.3" ry="1.7" fill="#e3787c"/>
      </g>
      ${glasses}
    </g>

    <path d="M2 -73 C-8 -73 -16 -68 -17.5 -58 C-15 -63 -9 -64.5 -4 -61 C-1 -66 4 -68 7.5 -66 C11 -64.5 15 -60 16.8 -56 C17 -66 11 -73 2 -73 Z" fill="url(#${id}-roots)"/>
    <path d="M-15.5 -59 C-12 -62.5 -7.5 -62.5 -4.5 -60.2 M4.5 -66 C9.5 -66 13.6 -62 15.6 -57.5" fill="none" stroke="${hairS}" stroke-width=".9" stroke-linecap="round" opacity=".7"/>
    <path d="M-9 -70 C-14 -66 -17 -60 -17 -55 M12 -70 C16 -66 18 -61 18 -56" fill="none" stroke="${hairL}" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
  </g>

</svg>`;
}

export function mountSpinner(el, config) {
  el.innerHTML = spinnerSVG(config);
  return el.firstElementChild;
}
