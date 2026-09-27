import { FillGradient, Graphics } from 'pixi.js';
import { PALETTE, TILE } from './config';
import { lerpColor } from './color';
import { DIRS } from './types';
import type { Dir, DaemonId } from './types';

// ---------------------------------------------------------------------------
// Procedural vector art. Everything is drawn centred on (0,0) so callers can
// position the containing display object freely. Shapes are ported from the
// concept sheet (.concept/*.dc.html): a spiked acid-green virus and the four
// shield-bodied daemons.
// ---------------------------------------------------------------------------

/** Default direction used whenever a caller omits one. */
const FACING: Dir = 'right';

// ---------------------------------------------------------------------------
// The virus
// ---------------------------------------------------------------------------

export interface VirusStyle {
  /** 0..1 mouth opening, from the simulation (0 = closed). */
  mouth?: number;
  /** The face slides + mirrors toward this direction. */
  dir?: Dir;
  /** EXPLOIT: red body, longer gold-tipped spikes, gold pupils. */
  powered?: boolean;
  /** HALT's FREEZE: spiral eyes and an "O" mouth, under the ice. */
  frozen?: boolean;
  /** Quarantined: shatter into pixels between closing brackets. */
  dying?: boolean;
  /** Progress of the death animation, 0..1. */
  deathT?: number;
  /** Slow spike-ring rotation, in radians. */
  spin?: number;
}

// Body gradients are cached per colour pair: a FillGradient owns a texture, so
// building one per frame would churn GPU memory. `textureSpace: 'local'` maps
// them over the shape's bounds (stable for a given drawing).
const virusGradients = new Map<string, FillGradient>();
function virusGradient(top: number, mid: number, bot: number): FillGradient {
  const key = `${top},${mid},${bot}`;
  let grad = virusGradients.get(key);
  if (!grad) {
    grad = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: top },
        { offset: 0.5, color: mid },
        { offset: 1, color: bot },
      ],
    });
    virusGradients.set(key, grad);
  }
  return grad;
}

const GREEN_GRAD = (): FillGradient => virusGradient(PALETTE.virusLight, PALETTE.virus, PALETTE.virusDark);
const HOT_GRAD = (): FillGradient => virusGradient(PALETTE.virusHot, PALETTE.virusHot, PALETTE.virusHotDark);

/**
 * Draw the virus: an acid-green cell ringed by eight knobbly spikes, with an
 * evil face that slides toward the direction of travel. `r` is the tip radius
 * (the body is a touch smaller, as in the concept).
 */
export function drawVirus(g: Graphics, r: number, style: VirusStyle = {}): void {
  if (style.dying) {
    drawVirusShatter(g, r, style.deathT ?? 0);
    return;
  }

  const u = r / 16.5;
  const body = 11.5 * u;
  const powered = !!style.powered;
  const frozen = !!style.frozen;
  const dir = style.dir ?? FACING;

  // Spikes: stems from the body edge, knobbed at the tip, rotating slowly.
  const spin = style.spin ?? 0;
  const n = 8;
  const stemEnd = (powered ? 17 : 15) * u;
  const knobAt = (powered ? 19 : 16.5) * u;
  const knobR = (powered ? 2.6 : 2.4) * u;
  const stemColor = powered ? PALETTE.virusHotLine : PALETTE.virusStem;
  const knobColor = powered ? PALETTE.gold : frozen ? PALETTE.virusFrost : PALETTE.virus;
  const knobLine = powered ? PALETTE.virusHotLine : PALETTE.virusLine;
  for (let i = 0; i < n; i++) {
    const a = spin + (i * Math.PI) / 4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.moveTo(ca * body, sa * body).lineTo(ca * stemEnd, sa * stemEnd);
    g.stroke({ width: (powered ? 2.6 : 2.4) * u, color: stemColor, cap: 'round' });
    g.circle(ca * knobAt, sa * knobAt, knobR)
      .fill(knobColor)
      .stroke({ width: 0.7 * u, color: knobLine });
  }

  // Soft halo, body gradient and outline.
  g.circle(0, 0, body * 1.45).fill({ color: powered ? PALETTE.virusHot : PALETTE.virus, alpha: 0.12 });
  g.circle(0, 0, body).fill(powered ? HOT_GRAD() : GREEN_GRAD());
  g.circle(0, 0, body).stroke({ width: 0.8 * u, color: powered ? PALETTE.virusHotLine : PALETTE.virusLine });

  // Shading spots and the two RGB glitch pixels (normal body only).
  if (!powered) {
    g.circle(-6.5 * u, 5 * u, 1.7 * u).fill(PALETTE.virusSpot);
    g.circle(-7.5 * u, -2.5 * u, 1.1 * u).fill(PALETTE.virusSpot);
    g.rect(-14 * u, 3 * u, 3 * u, 3 * u).fill(PALETTE.accent);
    g.rect(12.5 * u, -6 * u, 2.5 * u, 2.5 * u).fill(PALETTE.accent2);
  } else {
    g.circle(-6.5 * u, 5 * u, 1.6 * u).fill(PALETTE.virusHotDark);
  }

  // Face space: the concept's coordinates, shifted + mirrored for the heading.
  const vertical = dir === 'up' || dir === 'down';
  const sx = dir === 'left' ? -1 : 1;
  const dx = (vertical ? -3.4 : 0) * u;
  const dy = (dir === 'up' ? -2.6 : dir === 'down' ? 2.6 : 0) * u;
  const X = (x: number): number => (x * u + dx) * sx;
  const Y = (y: number): number => y * u + dy;
  const line = powered ? PALETTE.virusHotLine : PALETTE.virusLine;

  // Angled brows (a frozen virus loses its scowl for the spiral stare).
  if (!frozen) {
    g.moveTo(X(-3.5), Y(-7.5)).lineTo(X(2), Y(-5));
    g.moveTo(X(10), Y(-7.5)).lineTo(X(4.5), Y(-5));
    g.stroke({ width: 1.8 * u, color: line, cap: 'round' });
  }

  // Eyes.
  g.circle(X(-0.5), Y(-2.8), 2.6 * u).fill(PALETTE.white);
  g.circle(X(6.5), Y(-2.8), 2.6 * u).fill(PALETTE.white);
  if (frozen) {
    for (const ex of [-0.5, 6.5]) {
      g.circle(X(ex), Y(-2.8), 1.6 * u).stroke({ width: 0.7 * u, color: line });
      g.circle(X(ex), Y(-2.8), 0.6 * u).fill(line);
    }
  } else {
    const pupil = powered ? PALETTE.gold : PALETTE.danger;
    g.circle(X(-0.5), Y(-2.8), 1.3 * u).fill(pupil);
    g.circle(X(6.5), Y(-2.8), 1.3 * u).fill(pupil);
  }

  // Mouth: opens top-to-bottom with teeth on both jaws (never a wedge).
  if (frozen) {
    g.ellipse(X(3.2), Y(4.4), 1.9 * u, 2.4 * u).fill(line);
  } else {
    const m = Math.max(0, Math.min(1, style.mouth ?? 0.4));
    const x1 = Math.min(X(-2.2), X(9.2));
    const x2 = Math.max(X(-2.2), X(9.2));
    const top = Y(1.2);
    const bot = Y(1.2 + 1.1 + m * (powered ? 8.8 : 7.8));
    g.roundRect(x1, top, x2 - x1, bot - top, 2.2 * u).fill(PALETTE.bg);

    const reach = Math.min(bot - top, 3 * u);
    if (powered) {
      // Two heavy fangs per jaw.
      for (const a of [0.2, 0.72]) {
        const cx = x1 + (x2 - x1) * a;
        g.moveTo(cx - 1.5 * u, top).lineTo(cx + 1.5 * u, top).lineTo(cx, top + reach * 1.25).closePath();
      }
      g.fill(PALETTE.white);
      for (const a of [0.32, 0.6]) {
        const cx = x1 + (x2 - x1) * a;
        g.moveTo(cx - 1.3 * u, bot).lineTo(cx + 1.3 * u, bot).lineTo(cx, bot - reach * 1.05).closePath();
      }
      g.fill(PALETTE.white);
    } else {
      const teeth = 9;
      for (let i = 0; i < teeth; i++) {
        const cx = x1 + ((i + 0.5) * (x2 - x1)) / teeth;
        const hw = ((x2 - x1) / teeth) * 0.34;
        g.moveTo(cx - hw, top).lineTo(cx + hw, top).lineTo(cx, top + reach).closePath();
      }
      g.fill(PALETTE.white);
      const lower = 8;
      const lowReach = Math.min(bot - top, 2.1 * u);
      for (let i = 0; i < lower; i++) {
        const cx = x1 + ((i + 0.5) * (x2 - x1)) / lower;
        const hw = ((x2 - x1) / lower) * 0.32;
        g.moveTo(cx - hw, bot).lineTo(cx + hw, bot).lineTo(cx, bot - lowReach).closePath();
      }
      g.fill(PALETTE.white);
    }
  }
}

/** The quarantined virus: shattering pixels between brackets closing in. */
function drawVirusShatter(g: Graphics, r: number, t: number): void {
  const u = r / 16.5;
  const k = Math.min(1, t / 0.6);
  const arm = r * 0.55 * (1 - 0.3 * k);
  const off = r * (1.02 - 0.5 * k);
  const h = r * 1.5;
  const w = r * 0.16;
  for (const side of [-1, 1]) {
    const x = side * off;
    const xo = side * (off - arm);
    g.moveTo(xo, -h).lineTo(x, -h).lineTo(x, h).lineTo(xo, h);
  }
  g.stroke({ width: w, color: PALETTE.danger, cap: 'round', join: 'round' });

  const pixels: Array<[number, number, number]> = [
    [-12, -12, 7],
    [-4, -12, 7],
    [4, -12, 7],
    [-12, -4, 7],
    [-4, -4, 7],
    [4, -4, 6],
    [-12, 4, 7],
    [-2, 6, 7],
    [16, -26, 5],
    [26, 12, 5],
    [-30, 20, 5],
    [-30, -32, 4],
    [12, 28, 4],
    [-22, -8, 4],
  ];
  const palette = [
    PALETTE.virus,
    PALETTE.virusLight,
    PALETTE.virus,
    PALETTE.virusDark,
    PALETTE.white,
    PALETTE.danger,
    PALETTE.virus,
    PALETTE.virusDark,
    PALETTE.virus,
    PALETTE.accent,
    PALETTE.accent2,
    PALETTE.virus,
    PALETTE.white,
    PALETTE.virusLight,
  ];
  const spread = 1 + k * 0.9;
  for (let i = 0; i < pixels.length; i++) {
    const [x, y, s] = pixels[i];
    g.rect(x * u * spread, y * u * spread, s * u, s * u).fill({
      color: palette[i],
      alpha: 1 - 0.55 * k,
    });
  }
}

// ---------------------------------------------------------------------------
// The daemons
// ---------------------------------------------------------------------------

export interface DaemonStyle {
  color: number;
  colorDark: number;
  id: DaemonId;
  dir: Dir;
  /** CORRUPTED: dark body, RGB offsets, terrified face. */
  frightened?: boolean;
  /** End-of-exploit blink: the same scared face on a light body. */
  flash?: boolean;
  /** DELETED: dashed outline, X eyes, drooping antenna. */
  eaten?: boolean;
  /** REBOOTING inside the quarantine: sleeping, translucent, with a bar. */
  quarantine?: boolean;
  /** REBOOT progress, 0..1. */
  respawn?: number;
  /** Ability active (dash/phase): squinted eyes, gritted teeth, tilted antenna. */
  ability?: boolean;
  /** NULL's BYPASS while inside a wall: dashed. */
  phase?: boolean;
  /** Explicit gaze override, in tiles (defaults to `dir`). */
  lookX?: number;
  lookY?: number;
}

// Body gradients cached per daemon colour, as above.
const daemonGradients = new Map<number, FillGradient>();
function daemonGradient(color: number, colorDark: number): FillGradient {
  let grad = daemonGradients.get(color);
  if (!grad) {
    grad = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: lerpColor(color, PALETTE.white, 0.38) },
        { offset: 0.5, color },
        { offset: 1, color: colorDark },
      ],
    });
    daemonGradients.set(color, grad);
  }
  return grad;
}

/** The shield outline as a path (scaled by `s`, optionally offset). */
function shieldPath(g: Graphics, s: number, k = 1, ox = 0, oy = 0): void {
  const X = (v: number): number => ox + v * s * k;
  const Y = (v: number): number => oy + v * s * k;
  g.moveTo(X(0), Y(-18));
  g.lineTo(X(15), Y(-12));
  g.lineTo(X(15), Y(1));
  g.bezierCurveTo(X(15), Y(10), X(8), Y(16), X(0), Y(19));
  g.bezierCurveTo(X(-8), Y(16), X(-15), Y(10), X(-15), Y(1));
  g.lineTo(X(-15), Y(-12));
  g.closePath();
}

/** The shield outline sampled as a flat [x0,y0,x1,y1,...] loop, for dashes. */
function shieldPoints(s: number, k = 1): number[] {
  const pts: number[] = [];
  const push = (x: number, y: number): void => {
    pts.push(x * s * k, y * s * k);
  };
  push(0, -18);
  push(15, -12);
  push(15, 1);
  const cubic = (
    x0: number,
    y0: number,
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x1: number,
    y1: number,
  ): void => {
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      const mt = 1 - t;
      push(
        mt * mt * mt * x0 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x1,
        mt * mt * mt * y0 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y1,
      );
    }
  };
  cubic(15, 1, 15, 10, 8, 16, 0, 19);
  cubic(0, 19, -8, 16, -15, 10, -15, 1);
  push(-15, -12);
  return pts;
}

/** Stroke a closed sampled loop as dashes (Pixi strokes have no dash style). */
function dashPath(
  g: Graphics,
  pts: number[],
  dash: number,
  gap: number,
  width: number,
  color: number,
  alpha = 1,
): void {
  const period = dash + gap;
  let acc = 0;
  let px = pts[0];
  let py = pts[1];
  let prevOn = true;
  for (let i = 2; i <= pts.length; i += 2) {
    const j = i % pts.length;
    const x = pts[j];
    const y = pts[j + 1];
    // Split each edge into ~2px steps, advancing by a fixed delta so the walk
    // can't overshoot the corner.
    const len = Math.hypot(x - px, y - py);
    const steps = Math.max(1, Math.ceil(len / 2));
    const sx = (x - px) / steps;
    const sy = (y - py) / steps;
    const sl = len / steps;
    for (let k = 0; k < steps; k++) {
      const nx = px + sx;
      const ny = py + sy;
      const on = acc % period < dash;
      if (on && prevOn) g.moveTo(px, py).lineTo(nx, ny);
      px = nx;
      py = ny;
      acc += sl;
      prevOn = on;
    }
  }
  g.stroke({ width, color, alpha, cap: 'butt' });
}

/** Flat shield silhouette, used for afterimages and motion trails. */
export function drawDaemonSilhouette(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  color: number,
  alpha: number,
): void {
  shieldPath(g, r / 15, 1, x, y);
  g.fill({ color, alpha });
}

function drawAntenna(
  g: Graphics,
  s: number,
  tilt: number,
  led: number,
  lineColor: number,
): void {
  const ax = Math.sin(tilt) * 5 * s;
  const ay = -18 * s - Math.cos(tilt) * 5 * s;
  const lx = Math.sin(tilt) * 6.5 * s;
  const ly = -18 * s - Math.cos(tilt) * 6.5 * s;
  g.moveTo(0, -18 * s).lineTo(ax, ay);
  g.stroke({ width: 1.1 * s, color: lineColor, cap: 'round' });
  g.circle(lx, ly, 2.6 * s).fill(led).stroke({ width: 0.7 * s, color: PALETTE.virusLine });
}

type EyeMode = 'open' | 'squint' | 'half' | 'wide';

function drawEyes(
  g: Graphics,
  s: number,
  mode: EyeMode,
  look: { x: number; y: number },
  stroke: number,
): void {
  const ex = 5.5 * s;
  const ey = -6 * s;
  const rx = 4 * s;
  const ry = mode === 'squint' ? 2.6 * s : mode === 'half' ? 2.3 * s : mode === 'wide' ? 5 * s : 4.6 * s;
  const pr = mode === 'wide' ? 1 * s : mode === 'squint' ? 1.8 * s : mode === 'half' ? 1.6 * s : 2.1 * s;
  g.ellipse(-ex, ey, rx, ry).fill(PALETTE.eyeWhite).stroke({ width: 0.6 * s, color: stroke });
  g.ellipse(ex, ey, rx, ry).fill(PALETTE.eyeWhite).stroke({ width: 0.6 * s, color: stroke });
  const lx = look.x * 1.2 * s;
  const ly = look.y * 1.2 * s;
  g.circle(-ex + lx, ey + ly, pr).fill(PALETTE.eyePupil);
  g.circle(ex + lx, ey + ly, pr).fill(PALETTE.eyePupil);
  if (mode !== 'wide') {
    g.circle(-ex + lx - 0.6 * s, ey + ly - 0.7 * s, 0.55 * s).fill({ color: PALETTE.white, alpha: 0.9 });
    g.circle(ex + lx - 0.6 * s, ey + ly - 0.7 * s, 0.55 * s).fill({ color: PALETTE.white, alpha: 0.9 });
  }
}

/** The chest emblem: the daemon's own ability, in miniature. */
function drawEmblem(g: Graphics, s: number, id: DaemonId): void {
  const e = (x: number, y: number): [number, number] => [x * 0.5 * s, (y * 0.5 + 8.5) * s];
  const dark = PALETTE.virusLine;
  switch (id) {
    case 'volt': {
      const pts = [
        [2, 1],
        [-4, 9],
        [0, 9],
        [-2, 15],
        [5, 6],
        [1, 6],
        [3, 1],
      ].map(([x, y]) => e(x, y));
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath().fill(dark);
      break;
    }
    case 'relay': {
      g.moveTo(...e(-6, 8)).lineTo(...e(3, 8));
      g.moveTo(...e(0, 5)).lineTo(...e(3, 8)).lineTo(...e(0, 11));
      g.moveTo(...e(6, 4)).lineTo(...e(6, 12));
      g.stroke({ width: 1.1 * s, color: dark, cap: 'round', join: 'round' });
      break;
    }
    case 'null': {
      const [cx, cy] = e(0, 8);
      g.circle(cx, cy, 2.25 * s).stroke({ width: 1.1 * s, color: dark });
      g.moveTo(...e(-5, 14)).lineTo(...e(5, 2)).stroke({ width: 1.1 * s, color: dark, cap: 'round' });
      break;
    }
    case 'halt': {
      const [rx, ry] = e(-4.5, 3);
      const rw = 1.5 * s;
      const rh = 5 * s;
      g.rect(rx, ry, rw, rh).fill(dark);
      g.rect(rx + 3 * s, ry, rw, rh).fill(dark);
      break;
    }
  }
}

/**
 * Draw a daemon: a shield body with a per-daemon gradient, antenna LED, big
 * tracking eyes and a chest emblem. The face carries the daemon's personality
 * and its current state (ability, corrupted, deleted, rebooting).
 */
export function drawDaemon(g: Graphics, r: number, style: DaemonStyle): void {
  const s = r / 15;
  const { id, color, colorDark } = style;
  const dir = style.dir;
  const corrupted = !!style.frightened;
  const flash = !!style.flash;
  const ability = !!style.ability;
  const phase = !!style.phase;

  if (style.eaten) {
    // DELETED, floating home: a dashed, empty shell, X eyes, sagging antenna.
    shieldPath(g, s);
    g.fill({ color: PALETTE.accent, alpha: 0.07 });
    g.moveTo(0, -18 * s).quadraticCurveTo(4 * s, -20 * s, 7 * s, -20 * s);
    g.stroke({ width: 1 * s, color: PALETTE.accent, cap: 'round' });
    g.circle(7.6 * s, -19.4 * s, 2 * s).stroke({ width: 0.8 * s, color: PALETTE.accent });
    dashPath(g, shieldPoints(s), 2.5 * s, 2 * s, 1 * s, PALETTE.accent);
    const ex = 5.5 * s;
    const ey = -6 * s;
    const k = 2 * s;
    g.moveTo(-ex - k, ey - k).lineTo(-ex + k, ey + k);
    g.moveTo(-ex + k, ey - k).lineTo(-ex - k, ey + k);
    g.moveTo(ex - k, ey - k).lineTo(ex + k, ey + k);
    g.moveTo(ex + k, ey - k).lineTo(ex - k, ey + k);
    g.stroke({ width: 1.6 * s, color: PALETTE.text, cap: 'round' });
    g.moveTo(-3 * s, 3.5 * s).quadraticCurveTo(0, 2 * s, 3 * s, 3.5 * s);
    g.stroke({ width: 1.2 * s, color: PALETTE.text, cap: 'round' });
    return;
  }

  if (style.quarantine) {
    // REBOOTING: translucent, dashed, asleep, with a progress bar.
    shieldPath(g, s);
    g.fill({ color, alpha: 0.4 });
    drawAntenna(g, s, 0, PALETTE.corruptBrow, PALETTE.virusLine);
    dashPath(g, shieldPoints(s), 3 * s, 2.5 * s, 1 * s, lerpColor(color, PALETTE.white, 0.35), 0.95);
    g.moveTo(-8 * s, -6 * s).quadraticCurveTo(-5.5 * s, -4 * s, -3 * s, -6 * s);
    g.moveTo(3 * s, -6 * s).quadraticCurveTo(5.5 * s, -4 * s, 8 * s, -6 * s);
    g.stroke({ width: 1.3 * s, color: PALETTE.white, cap: 'round' });
    g.moveTo(-2 * s, 3 * s).lineTo(2 * s, 3 * s).stroke({ width: 1.2 * s, color: PALETTE.white, cap: 'round' });
    // REBOOT progress bar, centred under this daemon. Each chamber is two tiles
    // wide, so the bar is kept sub-tile-wide: it stays inside the chamber's
    // inner frame and clears a daemon on the neighbouring tile.
    const frac = Math.max(0, Math.min(1, style.respawn ?? 0));
    const bar = lerpColor(color, PALETTE.white, 0.35);
    const bw = TILE * 0.72;
    const bh = TILE * 0.15;
    const by = r * 1.7;
    g.roundRect(-bw / 2, by, bw, bh, bh / 2).stroke({ width: 1, color: bar, alpha: 0.9 });
    if (frac > 0) g.roundRect(-bw / 2 + 1.4, by + 1.4, (bw - 2.8) * frac, bh - 2.8, (bh - 2.8) / 2).fill(bar);
    return;
  }

  if (corrupted) {
    // CORRUPTED: the colour drains away and RGB noise rings the body.
    shieldPath(g, s, 1, -1.6 * s, 0.6 * s);
    g.stroke({ width: 1.1 * s, color: PALETTE.accent });
    shieldPath(g, s, 1, 1.6 * s, -0.6 * s);
    g.stroke({ width: 1.1 * s, color: PALETTE.accent2 });
    shieldPath(g, s);
    g.fill(PALETTE.corrupted);
    drawAntenna(g, s, 0, 0x4a2f7a, 0x6a2b8f);
    drawEyes(g, s, 'wide', { x: 0, y: 0 }, PALETTE.virusLine);
    g.moveTo(-9.5 * s, -12 * s).lineTo(-2.5 * s, -14.5 * s);
    g.moveTo(9.5 * s, -12 * s).lineTo(2.5 * s, -14.5 * s);
    g.stroke({ width: 1.5 * s, color: PALETTE.corruptBrow, cap: 'round' });
    g.ellipse(0, 4 * s, 2 * s, 2.6 * s)
      .fill(PALETTE.bgDeep)
      .stroke({ width: 0.6 * s, color: PALETTE.corruptBrow });
    g.moveTo(12 * s, -15 * s)
      .quadraticCurveTo(14.2 * s, -11 * s, 12 * s, -9.6 * s)
      .quadraticCurveTo(9.8 * s, -11 * s, 12 * s, -15 * s)
      .closePath()
      .fill(PALETTE.sweat);
    return;
  }

  if (flash) {
    // BLINKING: the exploit is running out. Light body, same scared face.
    shieldPath(g, s);
    g.fill(PALETTE.corruptFlash).stroke({ width: 1.1 * s, color: PALETTE.accent });
    drawAntenna(g, s, 0, PALETTE.corruptFlash, PALETTE.corruptBrow);
    drawEyes(g, s, 'wide', { x: 0, y: 0 }, PALETTE.corruptBrow);
    g.moveTo(-9.5 * s, -12 * s).lineTo(-2.5 * s, -14.5 * s);
    g.moveTo(9.5 * s, -12 * s).lineTo(2.5 * s, -14.5 * s);
    g.stroke({ width: 1.5 * s, color: 0x6a2b8f, cap: 'round' });
    g.ellipse(0, 4 * s, 2 * s, 2.6 * s).fill(0x6a2b8f);
    return;
  }

  // Normal / ability body.
  shieldPath(g, s);
  g.fill(daemonGradient(color, colorDark));
  shieldPath(g, s, 0.82);
  g.stroke({ width: 0.6 * s, color: PALETTE.white, alpha: 0.35 });
  if (ability) {
    shieldPath(g, s);
    g.stroke({ width: 1.5 * s, color: PALETTE.white });
  }
  drawAntenna(g, s, ability ? -0.35 : 0, ability ? PALETTE.white : color, PALETTE.virusLine);

  const look =
    style.lookX !== undefined || style.lookY !== undefined
      ? { x: style.lookX ?? 0, y: style.lookY ?? 0 }
      : dir === 'none'
        ? { x: 0, y: 0 }
        : DIRS[dir];
  drawEyes(g, s, ability ? 'squint' : id === 'null' ? 'half' : 'open', look, PALETTE.virusLine);

  if (ability) {
    // Gritted teeth.
    g.moveTo(-6 * s, 1 * s).lineTo(6 * s, 1 * s).lineTo(5 * s, 5 * s).lineTo(-5 * s, 5 * s).closePath().fill(PALETTE.bg);
    g.rect(-5 * s, 1 * s, 10 * s, 1.6 * s).fill(PALETTE.white);
    g.rect(-4.5 * s, 3.8 * s, 9 * s, 1.2 * s).fill(PALETTE.white);
  } else {
    switch (id) {
      case 'volt':
        // Angry brows and a clenched grin.
        g.moveTo(-10 * s, -12.5 * s).lineTo(-2.5 * s, -9.8 * s);
        g.moveTo(10 * s, -12.5 * s).lineTo(2.5 * s, -9.8 * s);
        g.stroke({ width: 1.9 * s, color: PALETTE.virusLine, cap: 'round' });
        g.moveTo(-5 * s, 1.5 * s).quadraticCurveTo(0, 7.5 * s, 5 * s, 1.5 * s).closePath().fill(PALETTE.bg);
        g.rect(-4 * s, 1.5 * s, 8 * s, 1.8 * s).fill(PALETTE.white);
        break;
      case 'relay':
        // One raised brow, one half-lidded eye, a smirk.
        g.moveTo(-9.5 * s, -8 * s).quadraticCurveTo(-5.5 * s, -11.5 * s, -1.5 * s, -8 * s).closePath().fill(colorDark);
        g.moveTo(-9.5 * s, -10.5 * s).lineTo(-2 * s, -10 * s);
        g.moveTo(2 * s, -12.5 * s).lineTo(9.5 * s, -14.5 * s);
        g.stroke({ width: 1.8 * s, color: PALETTE.virusLine, cap: 'round' });
        g.moveTo(-4.5 * s, 2.5 * s).quadraticCurveTo(1 * s, 4.5 * s, 5.5 * s, 0);
        g.stroke({ width: 1.6 * s, color: PALETTE.bg, cap: 'round' });
        break;
      case 'null':
        // Flat brows, a level mouth.
        g.moveTo(-9.5 * s, -7.8 * s).lineTo(-1.5 * s, -7.8 * s);
        g.moveTo(1.5 * s, -7.8 * s).lineTo(9.5 * s, -7.8 * s);
        g.stroke({ width: 1.4 * s, color: PALETTE.virusLine, cap: 'round' });
        g.moveTo(-2.5 * s, 3 * s).lineTo(2.5 * s, 3 * s);
        g.stroke({ width: 1.4 * s, color: PALETTE.bg, cap: 'round' });
        break;
      case 'halt':
        // Thick straight brows and a frown.
        g.moveTo(-9.5 * s, -11 * s).lineTo(-1.5 * s, -10 * s);
        g.moveTo(1.5 * s, -10 * s).lineTo(9.5 * s, -11 * s);
        g.stroke({ width: 2.4 * s, color: PALETTE.virusLine, cap: 'round' });
        g.moveTo(-4 * s, 4.5 * s).quadraticCurveTo(0, 1.5 * s, 4 * s, 4.5 * s);
        g.stroke({ width: 1.6 * s, color: PALETTE.bg, cap: 'round' });
        break;
    }
    drawEmblem(g, s, id);
  }

  if (phase) {
    // BYPASS, inside a wall: the body flickers into a dashed wireframe.
    dashPath(g, shieldPoints(s), 3 * s, 2 * s, 1.2 * s, PALETTE.accent, 0.9);
  }
}

// ---------------------------------------------------------------------------
// Items and scenery
// ---------------------------------------------------------------------------

/** The infected disk (the power pellet): a 3.5" floppy with the evil face. */
export function drawInfectedDisk(g: Graphics, x: number, y: number, s: number, glow = 1): void {
  const u = (v: number): number => v * s;
  g.circle(x, y, 15 * s * (0.9 + 0.1 * glow)).fill({ color: PALETTE.virus, alpha: 0.16 * glow });
  g.moveTo(x + u(-9), y + u(-9))
    .lineTo(x + u(6), y + u(-9))
    .lineTo(x + u(9), y + u(-6))
    .lineTo(x + u(9), y + u(9))
    .lineTo(x + u(-9), y + u(9))
    .closePath()
    .fill(PALETTE.virus)
    .stroke({ width: 1.2 * s, color: PALETTE.virusLine });
  // Shutter.
  g.rect(x + u(-5), y + u(-9), u(9), u(6)).fill(PALETTE.virusLine);
  g.rect(x + u(1), y + u(-8), u(2), u(4)).fill(PALETTE.virus);
  // Label with the face.
  g.roundRect(x + u(-7), y + u(-1.5), u(14), u(9.5), u(1)).fill(0xe6fff2);
  g.moveTo(x + u(-5.6), y + u(0)).lineTo(x + u(-1.6), y + u(1.8));
  g.moveTo(x + u(5.6), y + u(0)).lineTo(x + u(1.6), y + u(1.8));
  g.stroke({ width: 1.1 * s, color: PALETTE.bgDeep, cap: 'round' });
  g.circle(x + u(-3), y + u(2.9), 1.3 * s).fill(PALETTE.danger);
  g.circle(x + u(3), y + u(2.9), 1.3 * s).fill(PALETTE.danger);
  g.moveTo(x + u(-4), y + u(5))
    .quadraticCurveTo(x + u(0), y + u(8.6), x + u(4), y + u(5))
    .closePath()
    .fill(PALETTE.bgDeep);
  for (let i = 0; i < 7; i++) {
    const ax = x + u(-3.6) + i * u(1.05);
    g.moveTo(ax, y + u(5)).lineTo(ax + u(0.5), y + u(6.4)).lineTo(ax + u(1), y + u(5)).closePath();
  }
  g.fill(PALETTE.white);
}

/**
 * A nightmare firewall door: a vertical stack of alternating bricks ringed by
 * little flames. `x`,`y` is the door tile's centre; the flames point `outward`
 * (-1 left, +1 right) toward the ring.
 */
export function drawFirewall(
  g: Graphics,
  x: number,
  y: number,
  h: number,
  thick: number,
  alpha: number,
  outward: -1 | 1,
): void {
  const n = Math.max(3, Math.round(h / 15));
  const bh = h / n;
  const edge = x + outward * (thick / 2);
  for (let i = 0; i < n; i++) {
    const yy = y - h / 2 + i * bh;
    g.roundRect(x - thick / 2, yy + 0.6, thick, bh - 1.2, 1.5).fill({
      color: i % 2 ? PALETTE.brickB : PALETTE.brickA,
      alpha,
    });
    g.moveTo(edge, yy + bh * 0.2)
      .lineTo(edge + outward * 7, yy + bh * 0.5)
      .lineTo(edge, yy + bh * 0.8)
      .closePath()
      .fill({ color: PALETTE.flame, alpha: alpha * 0.85 });
  }
  g.roundRect(x - thick / 2 - 2, y - h / 2 - 2, thick + 4, h + 4, 3).stroke({
    width: 1.5,
    color: PALETTE.flame,
    alpha: alpha * 0.3,
  });
}

/**
 * The server core between the two quarantine chambers: a dark rack of drive
 * bays. Static art, so the game draws it once per maze.
 */
export function drawServerCore(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: number,
): void {
  const left = x - w / 2;
  const top = y - h / 2;
  g.roundRect(left, top, w, h, 3).fill(PALETTE.bgDeep);
  g.roundRect(left, top, w, h, 3).stroke({ width: 1.5, color: PALETTE.wallDim, alpha: 0.9 });
  // Three rows of paired drive bays.
  const slotW = (w - 14) / 2;
  for (let r = 0; r < 3; r++) {
    const ry = top + h * (0.2 + r * 0.28);
    for (let i = 0; i < 2; i++) {
      const sx = left + 6 + i * (slotW + 2);
      g.roundRect(sx, ry, slotW, h * 0.1, 1).fill(PALETTE.wallFill);
      g.roundRect(sx, ry, slotW, h * 0.1, 1).stroke({ width: 0.8, color: accent, alpha: 0.25 });
    }
  }
  g.moveTo(x, top + 4).lineTo(x, top + h - 4).stroke({ width: 1, color: PALETTE.wallDim, alpha: 0.5 });
}

/** Four-point star flare, the classic lens glint. */
export function drawSparkle(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
  alpha: number,
  rotation = 0,
): void {
  const w = size * 0.22;
  for (let k = 0; k < 4; k++) {
    const a = rotation + (k * Math.PI) / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.moveTo(x + ca * size, y + sa * size);
    g.lineTo(x - sa * w, y + ca * w);
    g.lineTo(x + sa * w, y - ca * w);
    g.closePath();
  }
  g.fill({ color, alpha });
}
