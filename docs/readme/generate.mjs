// Renders the README's vaporwave banner and section headers as SVG, in the
// game's palette and with its bundled font embedded (GitHub shows SVGs as
// <img>, which can't fetch webfonts). Run: node docs/readme/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const font = readFileSync(join(here, '../../src/assets/fonts/press-start-2p.woff2')).toString('base64');

// Kept in step with PALETTE / SKY / DAEMONS in src/config.ts.
const C = {
  bgDeep: '#0a0318',
  bg: '#1a0b34',
  pink: '#ff3fb0',
  accent: '#ff4fd8',
  cyan: '#00e5ff',
  text: '#ffe6ff',
  textDim: '#9d7fc4',
  chrome0: '#bff4ff',
  chrome2: '#d9b8ff',
  sunTop: '#ffd76a',
  sunMid: '#ff6fb0',
  sunBot: '#7a2ff0',
  skyUpper: '#2a0a4a',
  skyMid: '#5b1d6e',
  skyLower: '#8a2a7a',
  horizon: '#ff5f9e',
  bit: '#ffe3fb',
  eye: '#f7f4ff',
  pupil: '#24104a',
  virus: '#05ffa1',
  virusDark: '#0a7a4a',
  virusInk: '#0a3d27',
  virusG0: '#8dffc9',
  virusG1: '#0aa865',
};

// The four antivirus daemons: living shields, one accent colour each.
const DAEMONS = [
  { name: 'VOLT', accent: '#ff3fb0', grad: 'gVolt', g0: '#ff7ccc', g1: '#b0226f' },
  { name: 'RELAY', accent: '#00e5ff', grad: 'gRelay', g0: '#8ff4ff', g1: '#0a8aa0' },
  { name: 'NULL', accent: '#b967ff', grad: 'gNull', g0: '#d7a8ff', g1: '#5e2aa8' },
  { name: 'HALT', accent: '#ffc94d', grad: 'gHalt', g0: '#ffe29a', g1: '#b8741a' },
];

const style = `<style>@font-face{font-family:PS2P;src:url(data:font/woff2;base64,${font}) format('woff2')}text{font-family:PS2P,monospace}</style>`;

/** Deterministic noise so re-running the script doesn't churn the SVGs. */
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const gVirus = `<linearGradient id="gVirus" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.virusG0}"/><stop offset="1" stop-color="${C.virusG1}"/>
    </linearGradient>`;

const daemonGrad = (d) => `<linearGradient id="${d.grad}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${d.g0}"/><stop offset="1" stop-color="${d.g1}"/>
    </linearGradient>`;

/** The shield body every daemon shares, in base units (fits a 46-unit box). */
const SHIELD = 'M0,-18 L15,-12 L15,1 C15,10 8,16 0,19 C-8,16 -15,10 -15,1 L-15,-12 Z';

/**
 * A daemon's face, in the shield's base units. `px` is the pupil glide; the
 * brow and mouth differ per daemon (VOLT storms, RELAY smirks, NULL squints,
 * HALT frowns), and the chest carries its ability's icon.
 */
function daemonFace(idx, px) {
  const eye = (cx, cy, rx, ry) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${C.eye}" stroke="${C.bgDeep}" stroke-width=".6"/>`;
  const pupil = (cx, cy, r) => `<circle cx="${(cx + px).toFixed(1)}" cy="${cy}" r="${r}" fill="${C.pupil}"/>`;
  if (idx === 0) {
    return `${eye(-5.5, -6, 4, 4.6)}${eye(5.5, -6, 4, 4.6)}
      ${pupil(-4.1, -5.6, 2.1)}${pupil(6.9, -5.6, 2.1)}
      <circle cx="-3.4" cy="-6.4" r=".6" fill="#ffffff"/><circle cx="7.6" cy="-6.4" r=".6" fill="#ffffff"/>
      <path d="M-10,-12.5 L-2.5,-9.8 M10,-12.5 L2.5,-9.8" stroke="${C.bgDeep}" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M-5,1.5 Q0,7.5 5,1.5 Z" fill="${C.bg}"/><rect x="-4" y="1.5" width="8" height="1.8" fill="#ffffff"/>
      <path d="M2,1 L-4,9 L0,9 L-2,15 L5,6 L1,6 L3,1 Z" fill="${C.bg}" transform="translate(0 8.5) scale(.5)"/>`;
  }
  if (idx === 1) {
    return `${eye(-5.5, -6, 4, 4.6)}${eye(5.5, -6, 4, 4.6)}
      <path d="M-9.5,-8 Q-5.5,-11.5 -1.5,-8 Z" fill="#0a8aa0"/>
      ${pupil(-4.1, -5.2, 2.1)}${pupil(6.9, -5.6, 2.1)}
      <circle cx="7.6" cy="-6.4" r=".6" fill="#ffffff"/>
      <path d="M-9.5,-10.5 L-2,-10 M2,-12.5 L9.5,-14.5" stroke="${C.bgDeep}" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M-4.5,2.5 Q1,4.5 5.5,0" fill="none" stroke="${C.bg}" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M-6,8 L3,8 M0,5 L3,8 L0,11 M6,4 L6,12" fill="none" stroke="${C.bg}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 8.5) scale(.5)"/>`;
  }
  if (idx === 2) {
    return `${eye(-5.5, -5.5, 4, 2.3)}${eye(5.5, -5.5, 4, 2.3)}
      ${pupil(-4.2, -5.2, 1.6)}${pupil(6.8, -5.2, 1.6)}
      <path d="M-9.5,-7.8 L-1.5,-7.8 M1.5,-7.8 L9.5,-7.8" stroke="${C.bgDeep}" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M-2.5,3 L2.5,3" stroke="${C.bg}" stroke-width="1.4" stroke-linecap="round"/>
      <g transform="translate(0 8.5) scale(.5)"><circle cx="0" cy="8" r="4.5" fill="none" stroke="${C.bg}" stroke-width="2"/><path d="M-5,14 L5,2" stroke="${C.bg}" stroke-width="2" stroke-linecap="round"/></g>`;
  }
  return `${eye(-5.5, -6, 4, 4.6)}${eye(5.5, -6, 4, 4.6)}
    ${pupil(-4.1, -5.2, 2.1)}${pupil(6.9, -5.2, 2.1)}
    <path d="M-9.5,-11 L-1.5,-10 M1.5,-10 L9.5,-11" stroke="${C.bgDeep}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M-4,4.5 Q0,1.5 4,4.5" fill="none" stroke="${C.bg}" stroke-width="1.6" stroke-linecap="round"/>
    <g transform="translate(0 8.5) scale(.5)"><rect x="-4.5" y="3" width="3" height="10" fill="${C.bg}"/><rect x="1.5" y="3" width="3" height="10" fill="${C.bg}"/></g>`;
}

/**
 * One daemon (living shield, ~46-unit tall), its crest light and gradient in
 * the daemon's colour. `look` is the visual glance (-1 left); `facing` mirrors
 * the whole avatar so the face turns with the chase.
 */
function daemon(x, y, size, idx, look = 1, facing = 1) {
  const d = DAEMONS[idx];
  const k = size / 46;
  const px = 0.9 * look * facing;
  return `<g transform="translate(${x} ${y}) scale(${(facing * k).toFixed(4)} ${k.toFixed(4)})" filter="url(#glow)">
    <path d="M0,-18 L0,-23" stroke="${C.bgDeep}" stroke-width="1"/>
    <circle cx="0" cy="-24.5" r="2.6" fill="${d.accent}" stroke="${C.bgDeep}" stroke-width=".6"/>
    <path d="${SHIELD}" fill="url(#${d.grad})" stroke="${C.bgDeep}" stroke-width=".9"/>
    <path d="${SHIELD}" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width=".6" transform="scale(.82)"/>
    ${daemonFace(idx, px)}
  </g>`;
}

/** The acid-green virus: a spiny ball with a wicked grin, ~38-unit across. */
function virus(x, y, size, look = 1, facing = 1) {
  const k = size / 38;
  const px = 0.4 * look * facing;
  return `<g transform="translate(${x} ${y}) scale(${(facing * k).toFixed(4)} ${k.toFixed(4)})" filter="url(#glow)">
    <circle r="20" fill="${C.virus}" fill-opacity=".12"/>
    <path d="M11,0 L15,0 M7.8,7.8 L10.6,10.6 M0,11 L0,15 M-7.8,7.8 L-10.6,10.6 M-11,0 L-15,0 M-7.8,-7.8 L-10.6,-10.6 M0,-11 L0,-15 M7.8,-7.8 L10.6,-10.6" stroke="${C.virusDark}" stroke-width="2.4" stroke-linecap="round"/>
    <g fill="${C.virus}" stroke="${C.virusInk}" stroke-width=".7"><circle cx="16.5" cy="0" r="2.4"/><circle cx="11.7" cy="11.7" r="2.4"/><circle cx="0" cy="16.5" r="2.4"/><circle cx="-11.7" cy="11.7" r="2.4"/><circle cx="-16.5" cy="0" r="2.4"/><circle cx="-11.7" cy="-11.7" r="2.4"/><circle cx="0" cy="-16.5" r="2.4"/><circle cx="11.7" cy="-11.7" r="2.4"/></g>
    <circle r="11.5" fill="url(#gVirus)" stroke="${C.virusInk}" stroke-width=".7"/>
    <circle cx="-6.5" cy="5" r="1.7" fill="#0a9e5e"/><circle cx="-7.5" cy="-2.5" r="1.1" fill="#0a9e5e"/>
    <rect x="-14" y="3" width="3" height="3" fill="${C.pink}"/><rect x="12.5" y="-6" width="2.5" height="2.5" fill="${C.cyan}"/>
    <path d="M-3.5,-7.5 L2,-5 M10,-7.5 L4.5,-5" stroke="${C.virusInk}" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="${(-0.5 + px).toFixed(1)}" cy="-2.8" r="2.6" fill="#ffffff"/>
    <circle cx="${(6.5 + px).toFixed(1)}" cy="-2.8" r="2.6" fill="#ffffff"/>
    <circle cx="${(0.4 + px).toFixed(1)}" cy="-2.5" r="1.3" fill="#ff2d6e"/>
    <circle cx="${(7.4 + px).toFixed(1)}" cy="-2.5" r="1.3" fill="#ff2d6e"/>
    <path d="M-2,2.5 L9,2.5 L8,5 Q3.5,8.5 -1,5 Z" fill="${C.bg}"/>
    <path d="M-1.2,2.5 L-0.2,4.2 L0.8,2.5 L1.8,4.2 L2.8,2.5 L3.8,4.2 L4.8,2.5 L5.8,4.2 L6.8,2.5 L7.8,4.2 L8.4,2.5 Z" fill="#ffffff"/>
  </g>`;
}

/** The infected disk (power pellet): a green floppy with a wicked face. */
function floppy(x, y, size) {
  const k = size / 18;
  return `<g transform="translate(${x} ${y}) scale(${k.toFixed(4)})" filter="url(#glow)">
    <circle r="15" fill="${C.virus}" fill-opacity=".16"/>
    <path d="M-9,-9 L6,-9 L9,-6 L9,9 L-9,9 Z" fill="url(#gVirus)" stroke="${C.virusInk}" stroke-width="1.2"/>
    <rect x="-5" y="-9" width="9" height="6" fill="${C.virusInk}"/>
    <rect x="1" y="-8" width="2" height="4" fill="${C.virus}"/>
    <rect x="-7" y="-1.5" width="14" height="9.5" rx="1" fill="#e6fff2"/>
    <path d="M-5.6,0 L-1.6,1.8 M5.6,0 L1.6,1.8" stroke="${C.bg}" stroke-width="1.1" stroke-linecap="round"/>
    <circle cx="-3" cy="2.9" r="1.3" fill="#ff2d6e"/>
    <circle cx="3" cy="2.9" r="1.3" fill="#ff2d6e"/>
    <path d="M-4,5 L4,5 Q0,8.6 -4,5 Z" fill="${C.bg}"/>
    <path d="M-3,5 L-2.3,6 L-1.5,5 L-0.8,6 L0,5 L0.8,6 L1.5,5 L2.3,6 L3,5 Z" fill="#ffffff"/>
  </g>`;
}

const glowFilter = (id, blur) => `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="${blur}" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;

function banner() {
  const W = 1280;
  const H = 440;
  const HZ = 300; // horizon
  const rand = rng(7);

  const stars = Array.from({ length: 70 }, () => {
    const x = rand() * W;
    const y = rand() * (HZ - 90);
    const r = 0.6 + rand() * 1.3;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${C.text}" opacity="${(0.3 + rand() * 0.6).toFixed(2)}"/>`;
  }).join('');

  // Sun: gradient disc, sliced by widening gaps towards the horizon.
  const sunR = 118;
  const slices = Array.from({ length: 7 }, (_, i) => {
    const y = HZ - 74 + i * 11 + i * i * 0.7;
    const h = 2 + i * 1.6;
    return `<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${h.toFixed(1)}" fill="black"/>`;
  }).join('');

  // Wireframe ridges either side of the sun.
  const ridge = (x0, x1, peaks, seed) => {
    const r = rng(seed);
    const pts = [[x0, HZ]];
    for (let i = 1; i < peaks; i++) {
      const x = x0 + ((x1 - x0) * i) / peaks;
      pts.push([x, HZ - 25 - r() * 80]);
    }
    pts.push([x1, HZ]);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    const spokes = pts
      .slice(1, -1)
      .map(([x, y]) => `M${x.toFixed(1)} ${y.toFixed(1)}L${(x + (r() - 0.5) * 60).toFixed(1)} ${HZ}`)
      .join('');
    return `<path d="${d}Z" fill="${C.bgDeep}" opacity="0.92"/>
      <path d="${d}${spokes}" fill="none" stroke="${C.accent}" stroke-width="1.2" opacity="0.7"/>`;
  };

  // Perspective floor grid.
  const rows = Array.from({ length: 9 }, (_, i) => {
    const y = HZ + 3 + (i * i + i) * 1.75;
    return `<line x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  }).join('');
  const cols = Array.from({ length: 31 }, (_, i) => {
    const t = (i - 15) / 15;
    return `<line x1="${W / 2 + t * 90}" y1="${HZ}" x2="${W / 2 + t * 1500}" y2="${H}"/>`;
  }).join('');

  // The chase: the virus flees left along a row of bits, the squad on its tail.
  const floorY = 392;
  const bits = Array.from({ length: 7 }, (_, i) => {
    const x = 110 + i * 34;
    return `<rect x="${x - 3}" y="${floorY - 3}" width="6" height="6" fill="${C.bit}" filter="url(#glow)"/>`;
  }).join('');
  const squad = DAEMONS.map((_, i) => daemon(520 + i * 92, floorY - 8, 66, i, -1, -1)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Antivirus 95: you are the daemon">
  ${style}
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bgDeep}"/>
      <stop offset="0.35" stop-color="${C.skyUpper}"/>
      <stop offset="0.62" stop-color="${C.skyMid}"/>
      <stop offset="0.85" stop-color="${C.skyLower}"/>
      <stop offset="1" stop-color="${C.horizon}"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.sunTop}"/>
      <stop offset="0.55" stop-color="${C.sunMid}"/>
      <stop offset="1" stop-color="${C.sunBot}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.skyMid}"/>
      <stop offset="0.25" stop-color="${C.bg}"/>
      <stop offset="1" stop-color="${C.bgDeep}"/>
    </linearGradient>
    <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.chrome0}"/>
      <stop offset="0.45" stop-color="#ffffff"/>
      <stop offset="0.52" stop-color="${C.chrome2}"/>
      <stop offset="1" stop-color="${C.accent}"/>
    </linearGradient>
    <mask id="sunCut">
      <rect width="${W}" height="${HZ}" fill="white"/>
      ${slices}
    </mask>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="1.4" fill="black" opacity="0.22"/>
    </pattern>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.6" stop-color="black" stop-opacity="0"/>
      <stop offset="1" stop-color="black" stop-opacity="0.55"/>
    </radialGradient>
    ${glowFilter('glow', 1.6)}
    ${glowFilter('bigGlow', 6)}
    ${gVirus}
    ${DAEMONS.map(daemonGrad).join('\n    ')}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars}
  <circle cx="${W / 2}" cy="${HZ + 4}" r="${sunR + 36}" fill="${C.sunMid}" opacity="0.18" filter="url(#bigGlow)"/>
  <circle cx="${W / 2}" cy="${HZ + 4}" r="${sunR}" fill="url(#sun)" mask="url(#sunCut)"/>
  ${ridge(0, 470, 9, 3)}
  ${ridge(810, W, 9, 11)}
  <rect y="${HZ}" width="${W}" height="${H - HZ}" fill="url(#floor)"/>
  <g stroke="${C.pink}" stroke-width="1.3" opacity="0.65" filter="url(#glow)">${rows}${cols}</g>
  <line x1="0" x2="${W}" y1="${HZ}" y2="${HZ}" stroke="${C.horizon}" stroke-width="2.5" filter="url(#bigGlow)"/>
  ${floppy(58, floorY, 34)}
  ${bits}
  ${virus(390, floorY, 64, -1, -1)}
  ${squad}
  <g text-anchor="middle">
    <text x="${W / 2 + 5}" y="130" font-size="76" fill="${C.cyan}" opacity="0.75">ANTIVIRUS 95</text>
    <text x="${W / 2 - 5}" y="126" font-size="76" fill="${C.pink}" opacity="0.75">ANTIVIRUS 95</text>
    <text x="${W / 2}" y="128" font-size="76" fill="url(#chrome)" stroke="${C.bgDeep}" stroke-width="1.5" filter="url(#glow)">ANTIVIRUS 95</text>
    <text x="${W / 2}" y="168" font-size="18" fill="${C.text}" letter-spacing="4">YOU ARE THE DAEMON</text>
  </g>
  <rect width="${W}" height="${H}" fill="url(#scan)"/>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>
`;
}

/** Neon-sign section header: a dark plate, a daemon, gradient lettering. */
function header(title, idx) {
  const W = 880;
  const H = 76;
  const id = `h${idx}`;
  const rand = rng(100 + idx);
  const stars = Array.from({ length: 14 }, () =>
    `<circle cx="${(560 + rand() * 300).toFixed(1)}" cy="${(10 + rand() * 30).toFixed(1)}" r="${(0.6 + rand()).toFixed(2)}" fill="${C.text}" opacity="${(0.25 + rand() * 0.5).toFixed(2)}"/>`,
  ).join('');
  const grid = Array.from({ length: 9 }, (_, i) => {
    const t = (i - 4) / 4;
    return `<line x1="${760 + t * 40}" y1="50" x2="${760 + t * 190}" y2="${H}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${title}">
  ${style}
  <defs>
    <linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bgDeep}"/>
      <stop offset="0.65" stop-color="${C.skyUpper}"/>
      <stop offset="1" stop-color="${C.skyMid}"/>
    </linearGradient>
    <linearGradient id="${id}edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.pink}"/>
      <stop offset="1" stop-color="${C.cyan}"/>
    </linearGradient>
    <linearGradient id="${id}ink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.chrome0}"/>
      <stop offset="0.5" stop-color="#ffffff"/>
      <stop offset="0.56" stop-color="${C.chrome2}"/>
      <stop offset="1" stop-color="${C.accent}"/>
    </linearGradient>
    <linearGradient id="${id}fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.horizon}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${C.horizon}"/>
      <stop offset="1" stop-color="${C.horizon}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id}sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.sunTop}"/>
      <stop offset="1" stop-color="${C.sunMid}"/>
    </linearGradient>
    <clipPath id="${id}clip"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12"/></clipPath>
    ${glowFilter('glow', 1.4)}
    ${daemonGrad(DAEMONS[idx])}
  </defs>
  <g clip-path="url(#${id}clip)">
    <rect width="${W}" height="${H}" fill="url(#${id}bg)"/>
    ${stars}
    <path d="M734 50A26 26 0 0 1 786 50Z" fill="url(#${id}sun)" opacity="0.9"/>
    <line x1="520" x2="${W}" y1="50" y2="50" stroke="url(#${id}fade)" stroke-width="2" filter="url(#glow)"/>
    <g stroke="${C.pink}" stroke-width="1" opacity="0.55">${grid}
      <line x1="560" x2="${W}" y1="57" y2="57"/><line x1="540" x2="${W}" y1="66" y2="66"/></g>
  </g>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="none" stroke="url(#${id}edge)" stroke-width="2"/>
  ${daemon(44, 38, 40, idx, 1, 1)}
  <text x="84" y="50" font-size="26" fill="url(#${id}ink)" stroke="${C.bgDeep}" stroke-width="0.8" filter="url(#glow)">${title}</text>
</svg>
`;
}

writeFileSync(join(here, 'banner.svg'), banner());
const HEADERS = [
  ['play', 'PLAY'],
  ['steam-deck', 'STEAM DECK'],
  ['controls', 'CONTROLS'],
  ['squad', 'THE SQUAD'],
  ['rules', 'RULES'],
  ['build', 'BUILD IT'],
  ['credits', 'CREDITS'],
  ['support', 'SUPPORT'],
];
HEADERS.forEach(([file, title], i) => {
  writeFileSync(join(here, `h-${file}.svg`), header(title, i % DAEMONS.length));
});
console.log(`wrote banner.svg + ${HEADERS.length} headers`);
