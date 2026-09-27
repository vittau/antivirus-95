import { Container, FillGradient, Graphics, Text } from 'pixi.js';
import { BackdropBlurFilter } from 'pixi-filters';
import { lerpColor, sampleGradient } from './color';
import {
  FONT_FAMILY,
  DAEMONS,
  HUD_W,
  PALETTE,
  SCREEN_H,
  SCREEN_W,
  SKY,
  VIEW_W,
} from './config';
import { drawDaemon } from './draw';
import { valueNoise } from './noise';
import type { DaemonDef } from './config';
import type { InputDevice } from './input';

const SKY_STOPS = [SKY.top, SKY.upper, SKY.mid, SKY.lower, SKY.horizon];
const SUN_STOPS = [PALETTE.sunTop, PALETTE.sunMid, PALETTE.sunBot];
const ROW_Y = [40, 128, 216, 304];
const ROW_H = 84;
const ROW_DAEMON_R = 20;
const HORIZON = SCREEN_H * 0.55;
/** Height of the frosted header behind the title (the demo plays below it). */
export const HEADER_H = 220;

// The sun's slices: below SUN_CUT of the disc, a gap opens every SUN_PERIOD
// px, widening by SUN_GAP px per disc-height toward the bottom, drifting at
// SUN_DRIFT px/s. SUN_SPREAD stretches the gradient so the bottom holds violet.
const SUN_CUT = 0.42;
const SUN_PERIOD = 18;
const SUN_GAP = 30;
const SUN_DRIFT = 9;
const SUN_SPREAD = 1.1;

// Wireframe terrain: a heightmap seen from a camera one unit above the valley
// floor, flying forward. Units are arbitrary world units.
const TERRAIN = {
  // Below 1 so a row always sits past the bottom edge: the nearest struts run
  // off-screen instead of stopping short and leaving an empty strip.
  zNear: 0.4,
  // Far enough that the rows run right up to the mountains' feet; beyond
  // fogFar they thin out (every 2nd, then 4th row) and sink into the haze.
  zFar: 30,
  fogFar: 13,
  dz: 0.55, // row spacing
  dx: 0.5, // sample spacing along a row
  colEvery: 2, // a column line every N samples
  speed: 1.1,
};

/**
 * Where the mountains stand: the ground line of the farthest terrain row.
 * Their feet sit there rather than on the horizon (which is at infinity), so
 * the scrolling grid runs right up to them with no strip of bare floor.
 */
const MOUNTAIN_FOOT = HORIZON + (SCREEN_H - HORIZON) / TERRAIN.zFar;

interface Row {
  def: DaemonDef;
  box: Graphics;
  daemon: Graphics;
  name: Text;
  ability: Text;
  desc: Text;
}

const mkText = (
  text: string,
  size: number,
  fill: number,
  align: 'left' | 'center' | 'right' = 'left',
): Text => {
  const t = new Text({ text, style: { fontFamily: FONT_FAMILY, fontSize: size, fill, align } });
  t.anchor.set(align === 'left' ? 0 : align === 'center' ? 0.5 : 1, 0);
  return t;
};

/** 80s chrome lettering: sky above a hard horizon line, sunset below. */
const chromeFill = (): FillGradient =>
  new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: PALETTE.chrome0 },
      { offset: 0.46, color: PALETTE.chrome1 },
      { offset: 0.5, color: PALETTE.chrome2 },
      { offset: 0.54, color: PALETTE.sunBot },
      { offset: 0.8, color: PALETTE.sunMid },
      { offset: 1, color: PALETTE.sunTop },
    ],
  });

/** Controls legend for the device in use; both tables have the same rows. */
const CONTROLS: Record<InputDevice, Array<[string, string]>> = {
  keyboard: [
    ['ARROWS/WASD', 'MOVE'],
    ['1-4 / Q E', 'SQUAD STANCE'],
    ['SPACE', 'ABILITY'],
    ['P / ESC', 'PAUSE'],
    ['M', 'NEXT SONG'],
    ['C / F / N', 'CRT/FPS/MUTE'],
  ],
  gamepad: [
    ['D-PAD/STICK', 'MOVE'],
    ['L1 / R1', 'SQUAD STANCE'],
    ['A / R2', 'ABILITY'],
    ['MENU', 'PAUSE'],
    ['Y', 'NEXT SONG'],
    ['VIEW', 'MUTE'],
  ],
};

const START_BUTTON: Record<InputDevice, string> = { keyboard: 'SPACE', gamepad: 'A' };

interface Peak {
  x: number;
  h: number;
}

/**
 * Attract screen. Mirrors the in-game layout: the live demo plays in the
 * viewport on the left, and all UI sits in the right-hand panel column.
 * Vertical positions are fixed; layout() recomputes the horizontal ones.
 */
export class Menu {
  readonly bgLayer = new Container();
  readonly uiLayer = new Container();

  private readonly sky = new Graphics();
  private readonly stars = new Graphics();
  private readonly sunHalo = new Graphics();
  private readonly sun = new Graphics();
  private readonly mountains = new Graphics();
  private readonly floor = new Graphics();

  private readonly panelGfx = new Graphics();
  private readonly scrimGfx = new Graphics();
  private readonly dividers: Graphics[] = [];

  private readonly titleGlow = mkText('ANTIVIRUS 95', 50, PALETTE.accent2, 'center');
  private readonly titlePink = mkText('ANTIVIRUS 95', 50, PALETTE.accent, 'center');
  private readonly title = mkText('ANTIVIRUS 95', 50, PALETTE.chrome1, 'center');
  private readonly subtitle = mkText('YOU ARE THE DAEMON', 14, PALETTE.textDim, 'center');
  private readonly highText = mkText('', 12, PALETTE.accent, 'center');
  private readonly prompt = mkText('PRESS SPACE TO START', 16, PALETTE.gold, 'center');

  private readonly chooseText = mkText('CHOOSE YOUR DAEMON', 11, PALETTE.accent2);
  private readonly chooseHint = mkText('↑↓', 11, PALETTE.textDim, 'right');
  private readonly controlsTitle = mkText('CONTROLS', 11, PALETTE.accent2);
  private readonly howTitle = mkText('HOW TO WIN', 11, PALETTE.accent2);
  private readonly tipsText = mkText(
    'QUARANTINE IT 3× PER LEVEL\nALL BITS EATEN: GAME OVER\nINFECTED DISKS TURN THE TABLES',
    10,
    PALETTE.textDim,
  );

  private readonly rows: Row[] = [];
  private readonly controlsKeys: Text[] = [];
  private readonly controlsActions: Text[] = [];
  private readonly audioText = mkText('', 10, PALETTE.accent2);
  private readonly credit = mkText('MUSIC: VANDALORUM / PRIMAL LIGHT\nCC-BY 4.0', 9, PALETTE.textDim);

  private readonly starField: { x: number; y: number; r: number; p: number }[] = [];
  private farPeaks: Peak[] = [];
  private nearPeaks: Peak[] = [];
  private meteor = { x: 0, y: 0, vx: 0, vy: 0, life: 0 };
  private meteorWait = 3;
  private t = 0;
  /** Sun gradient, cached per disc geometry: a FillGradient owns a texture. */
  private sunGrad: FillGradient | null = null;
  private sunGradKey = '';
  /** Selection the daemon cards were last drawn for (-1: redraw). */
  private boxesFor = -1;

  constructor() {
    this.bgLayer.eventMode = 'none';
    this.uiLayer.eventMode = 'none';
    this.bgLayer.addChild(this.sky, this.stars, this.sunHalo, this.sun, this.mountains, this.floor);

    // Frosted glass behind the title and the side panel, so the text reads
    // cleanly over the busy demo. Optional: without it the tinted scrims
    // still do the job.
    try {
      const frost = new BackdropBlurFilter({ strength: 7, quality: 3 });
      this.scrimGfx.filters = [frost];
      this.panelGfx.filters = [frost];
    } catch {
      /* no backdrop support: plain scrims */
    }

    for (let i = 0; i < 140; i++) {
      this.starField.push({
        x: Math.random(),
        y: Math.random() * HORIZON * 0.92,
        r: Math.random() * 1.4 + 0.4,
        p: Math.random() * Math.PI * 2,
      });
    }

    for (const t of [this.titleGlow, this.titlePink, this.title]) {
      t.style.letterSpacing = 6;
      t.anchor.set(0.5, 0);
    }
    this.title.style.fill = chromeFill();
    this.title.style.stroke = { color: PALETTE.bgDeep, width: 2 };
    this.subtitle.anchor.set(0.5, 0);
    this.highText.anchor.set(0.5, 0);
    this.prompt.anchor.set(0.5, 0);
    this.tipsText.style.lineHeight = 17;
    this.credit.style.lineHeight = 14;

    this.uiLayer.addChild(
      this.scrimGfx,
      this.panelGfx,
      this.titlePink,
      this.titleGlow,
      this.title,
      this.subtitle,
      this.highText,
      this.prompt,
      this.chooseText,
      this.chooseHint,
      this.controlsTitle,
      this.howTitle,
      this.tipsText,
      this.audioText,
      this.credit,
    );

    this.buildPanel();
    this.layout();
  }

  private buildPanel(): void {
    DAEMONS.forEach((def) => {
      const box = new Graphics();
      const daemon = new Graphics();
      const name = mkText(def.name, 14, def.color);
      const ability = mkText(def.abilityName, 11, PALETTE.text);
      const desc = mkText(def.abilityDesc, 10, PALETTE.textDim);
      desc.style.wordWrap = true;
      desc.style.lineHeight = 14;
      this.uiLayer.addChild(box, daemon, name, ability, desc);
      this.rows.push({ def, box, daemon, name, ability, desc });
    });

    CONTROLS.keyboard.forEach(([key, action]) => {
      const k = mkText(key, 10, PALETTE.gold);
      const a = mkText(action, 10, PALETTE.text);
      this.controlsKeys.push(k);
      this.controlsActions.push(a);
      this.uiLayer.addChild(k, a);
    });

    for (let i = 0; i < 3; i++) {
      const g = new Graphics();
      this.dividers.push(g);
      this.uiLayer.addChild(g);
    }
  }

  /** Jagged ridge line spanning the whole width, lower toward the centre. */
  private makePeaks(count: number, maxH: number, seed: number): Peak[] {
    const out: Peak[] = [];
    let s = seed;
    const rnd = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const mid = VIEW_W / 2;
    for (let i = 0; i <= count; i++) {
      const x = (i / count) * SCREEN_W;
      // Valley in the middle of the viewport so the sun sits in a notch.
      const d = Math.min(1, Math.abs(x - mid) / (VIEW_W * 0.42));
      const h = (i % 2 === 0 ? 0.25 : 1) * maxH * (0.35 + 0.65 * rnd()) * (0.12 + 0.88 * d * d);
      out.push({ x, h });
    }
    return out;
  }

  /** Recompute every width-dependent position. Safe to call on resize. */
  layout(): void {
    const panelX = SCREEN_W - HUD_W;
    const cx = panelX + 24;
    const contentW = HUD_W - 48;
    const midX = VIEW_W / 2;

    this.farPeaks = this.makePeaks(34, 120, 7);
    this.nearPeaks = this.makePeaks(22, 80, 13);

    this.panelGfx.clear();
    this.panelGfx.rect(panelX, 0, HUD_W, SCREEN_H).fill({ color: PALETTE.bgDeep, alpha: 0.5 });
    this.panelGfx.rect(panelX, 0, 1, SCREEN_H).fill({ color: PALETTE.accent, alpha: 0.35 });

    this.scrimGfx.clear();
    this.scrimGfx.rect(0, 0, VIEW_W, HEADER_H).fill({ color: PALETTE.bgDeep, alpha: 0.45 });
    this.scrimGfx.rect(0, HEADER_H - 1, VIEW_W, 1).fill({ color: PALETTE.accent, alpha: 0.35 });

    this.title.position.set(midX, 62);
    this.titleGlow.position.set(midX + 3, 65);
    this.titlePink.position.set(midX - 3, 59);
    this.titleGlow.alpha = 0.9;
    this.titlePink.alpha = 0.75;
    this.subtitle.position.set(midX, 124);
    this.highText.position.set(midX, 150);
    this.prompt.position.set(midX, 178);

    this.chooseText.position.set(cx, 18);
    this.chooseHint.position.set(panelX + HUD_W - 24, 18);

    this.rows.forEach((row, i) => {
      // Centred in the gutter left of the text (box edge at cx - 4, text at
      // cx + 58). The body reaches r above its origin and ~1.16r below it
      // (skirt), so the origin sits a touch above the row's middle.
      row.daemon.position.set(cx + 28, ROW_Y[i] + ROW_H / 2 - ROW_DAEMON_R * 0.08);
      row.name.position.set(cx + 58, ROW_Y[i] + 10);
      row.ability.position.set(cx + 58, ROW_Y[i] + 32);
      row.desc.position.set(cx + 58, ROW_Y[i] + 50);
      row.desc.style.wordWrapWidth = contentW - 58;
    });

    const dividerY = [400, 576];
    this.dividers.forEach((g, i) => {
      g.clear();
      if (dividerY[i] === undefined) return;
      g.rect(panelX + 20, dividerY[i], HUD_W - 40, 1).fill({ color: PALETTE.accent, alpha: 0.22 });
    });

    this.controlsTitle.position.set(cx, 412);
    this.controlsKeys.forEach((k, i) => {
      k.position.set(cx, 434 + i * 20);
      this.controlsActions[i].position.set(cx + 128, 434 + i * 20);
    });

    this.howTitle.position.set(cx, 588);
    this.tipsText.position.set(cx, 610);
    this.audioText.position.set(cx, 676);
    this.credit.position.set(cx, 704);

    // The static backdrop only changes with the width.
    this.drawSky();
    this.drawSunHalo();
    this.drawMountains();
    this.boxesFor = -1;
  }

  update(
    dt: number,
    selected: number,
    high: number,
    phase: 'menu' | 'gameover',
    audioHint = '',
    muted = false,
    device: InputDevice = 'keyboard',
  ): void {
    this.t += dt;

    this.drawStars(dt);
    this.drawSun();
    this.drawFloor();

    this.prompt.alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * 4));
    this.subtitle.text = phase === 'gameover' ? 'GAME OVER' : 'YOU ARE THE DAEMON';
    this.subtitle.style.fill = phase === 'gameover' ? PALETTE.danger : PALETTE.textDim;
    const start = START_BUTTON[device];
    this.prompt.text = phase === 'gameover' ? `PRESS ${start} TO PLAY AGAIN` : `PRESS ${start} TO START`;
    CONTROLS[device].forEach(([key, action], i) => {
      this.controlsKeys[i].text = key;
      this.controlsActions[i].text = action;
    });
    this.highText.text = high > 0 ? `HIGH SCORE  ${String(high).padStart(6, '0')}` : '';
    this.audioText.text = muted ? `SOUND MUTED · ${device === 'gamepad' ? 'VIEW' : 'N'}` : audioHint;

    const panelX = SCREEN_W - HUD_W;
    const redrawBoxes = this.boxesFor !== selected;
    this.boxesFor = selected;
    this.rows.forEach((row, i) => {
      const active = i === selected;
      const w = HUD_W - 40;
      const x = panelX + 20;
      const y = ROW_Y[i];

      if (redrawBoxes) this.drawBox(row, active, x, y, w);

      row.daemon.clear();
      const pulse = active ? 1 + Math.sin(this.t * 5) * 0.05 : 1;
      drawDaemon(row.daemon, ROW_DAEMON_R * pulse, {
        color: row.def.color,
        colorDark: row.def.colorDark,
        id: row.def.id,
        dir: 'left',
      });
      row.name.alpha = active ? 1 : 0.7;
      row.ability.alpha = active ? 1 : 0.7;
      row.desc.alpha = active ? 0.95 : 0.6;
    });
  }

  /** A daemon's card in the panel; redrawn only when the selection moves. */
  private drawBox(row: Row, active: boolean, x: number, y: number, w: number): void {
    row.box.clear();
    row.box.roundRect(x, y, w, ROW_H, 8).fill({
      color: active ? PALETTE.wallFill : 0x120a26,
      alpha: active ? 0.95 : 0.5,
    });
    if (active) {
      // A wash of the daemon's colour from the left, like a lit arcade marquee.
      for (let k = 0; k < 6; k++) {
        row.box.roundRect(x, y, w * (0.2 + k * 0.12), ROW_H, 8).fill({ color: row.def.color, alpha: 0.03 });
      }
    }
    row.box.roundRect(x, y, w, ROW_H, 8).stroke({
      width: active ? 2 : 1,
      color: active ? row.def.color : PALETTE.wallDim,
      alpha: active ? 1 : 0.55,
    });
    if (active) {
      row.box.roundRect(x - 4, y - 4, w + 8, ROW_H + 8, 10).stroke({
        width: 1,
        color: PALETTE.accent2,
        alpha: 0.5,
      });
    }
  }

  private drawSky(): void {
    this.sky.clear();
    const bands = 56;
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands;
      const col = sampleGradient(SKY_STOPS, t0);
      this.sky.rect(0, t0 * HORIZON - 1, SCREEN_W, HORIZON / bands + 2).fill(col);
    }
    // Horizon glow, behind the mountains: it shows through the valleys only.
    this.sky.rect(0, HORIZON - 12, SCREEN_W, 12).fill({ color: PALETTE.horizon, alpha: 0.16 });
    this.sky.rect(0, HORIZON - 3, SCREEN_W, 5).fill({ color: PALETTE.horizon, alpha: 0.8 });
  }

  private drawStars(dt: number): void {
    const g = this.stars;
    g.clear();
    for (const s of this.starField) {
      const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.t * 2 + s.p));
      // Stars fade out as they approach the warm horizon haze.
      const fade = 1 - Math.pow(s.y / HORIZON, 2);
      g.circle(s.x * SCREEN_W, s.y, s.r).fill({ color: PALETTE.white, alpha: a * 0.8 * fade });
    }

    // The occasional shooting star.
    const m = this.meteor;
    if (m.life > 0) {
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const a = Math.min(1, m.life * 3);
      g.moveTo(m.x, m.y).lineTo(m.x - m.vx * 0.12, m.y - m.vy * 0.12);
      g.stroke({ width: 2, color: PALETTE.chrome0, alpha: a * 0.8, cap: 'round' });
      g.circle(m.x, m.y, 1.8).fill({ color: PALETTE.white, alpha: a });
    } else {
      this.meteorWait -= dt;
      if (this.meteorWait <= 0) {
        this.meteorWait = 4 + Math.random() * 6;
        const dir = Math.random() < 0.5 ? -1 : 1;
        m.x = Math.random() * SCREEN_W;
        m.y = 20 + Math.random() * HORIZON * 0.35;
        m.vx = dir * (420 + Math.random() * 240);
        m.vy = 120 + Math.random() * 80;
        m.life = 0.7;
      }
    }
  }

  /** The warm haze the sun sits in (static: drawn on layout). */
  private drawSunHalo(): void {
    const g = this.sunHalo;
    g.clear();
    const cx = VIEW_W / 2;
    const R = Math.min(190, VIEW_W * 0.2);
    const cy = HORIZON - R * 0.38;
    for (let i = 5; i >= 1; i--) {
      g.circle(cx, cy, R * (1 + i * 0.16)).fill({ color: PALETTE.sunMid, alpha: 0.025 + (5 - i) * 0.006 });
    }
  }

  /** The vaporwave sunset: gradient disc whose lower half is sliced by drifting bands. */
  private drawSun(): void {
    const g = this.sun;
    g.clear();
    const cx = VIEW_W / 2;
    const R = Math.min(190, VIEW_W * 0.2);
    const cy = HORIZON - R * 0.38;

    // Each solid slice is an exact circle segment with sub-pixel edges, all
    // filled from one disc-wide gradient, so the bands glide instead of
    // stepping a pixel row at a time.
    const top = cy - R;
    const fill = this.sunGradient(top, R);
    const halfWidth = (y: number): number => Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
    for (const [a, b] of this.sunSlices(2 * R, Math.min(HORIZON, cy + R) - top)) {
      const y0 = top + a;
      const y1 = top + b;
      const n = Math.max(2, Math.ceil((y1 - y0) / 1.5));
      g.moveTo(cx - halfWidth(y0), y0);
      for (let i = 1; i <= n; i++) {
        const y = y0 + ((y1 - y0) * i) / n;
        g.lineTo(cx - halfWidth(y), y);
      }
      for (let i = n; i >= 0; i--) {
        const y = y0 + ((y1 - y0) * i) / n;
        g.lineTo(cx + halfWidth(y), y);
      }
      g.closePath();
      g.fill(fill);
    }
  }

  /**
   * Solid stretches of a disc of height `d`, from its top down to `end`, as
   * offsets from the top edge. A gap starting at u lasts until the point e
   * where e - u equals the gap width there, (e/d - SUN_CUT) * SUN_GAP, which
   * solves exactly — no per-pixel test, so nothing snaps.
   */
  private sunSlices(d: number, end: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const scroll = (this.t * SUN_DRIFT) % SUN_PERIOD;
    const shrink = 1 - SUN_GAP / d;
    let cursor = 0;
    for (let k = Math.ceil((SUN_CUT * d + scroll) / SUN_PERIOD); ; k++) {
      const gapStart = k * SUN_PERIOD - scroll;
      if (gapStart >= end) break;
      const gapEnd = Math.min(end, (gapStart - SUN_CUT * SUN_GAP) / shrink);
      if (gapEnd <= gapStart) continue;
      if (gapStart > cursor) out.push([cursor, gapStart]);
      cursor = gapEnd;
    }
    if (cursor < end) out.push([cursor, end]);
    return out;
  }

  private sunGradient(top: number, R: number): FillGradient {
    const key = `${top},${R}`;
    if (this.sunGrad && this.sunGradKey === key) return this.sunGrad;
    this.sunGrad?.destroy();
    this.sunGrad = new FillGradient({
      type: 'linear',
      start: { x: 0, y: top },
      end: { x: 0, y: top + 2 * R },
      textureSpace: 'global',
      colorStops: [
        { offset: 0, color: SUN_STOPS[0] },
        { offset: 0.5 / SUN_SPREAD, color: SUN_STOPS[1] },
        { offset: 1 / SUN_SPREAD, color: SUN_STOPS[2] },
        { offset: 1, color: SUN_STOPS[2] },
      ],
    });
    this.sunGradKey = key;
    return this.sunGrad;
  }

  private drawMountains(): void {
    const g = this.mountains;
    g.clear();
    const layer = (peaks: Peak[], fill: number, edge: number, edgeAlpha: number): void => {
      g.moveTo(0, MOUNTAIN_FOOT);
      for (const p of peaks) g.lineTo(p.x, HORIZON - p.h);
      g.lineTo(SCREEN_W, MOUNTAIN_FOOT);
      g.closePath();
      g.fill(fill);

      // Wireframe: ridge line plus struts from each peak down to the base.
      g.moveTo(peaks[0].x, HORIZON - peaks[0].h);
      for (const p of peaks) g.lineTo(p.x, HORIZON - p.h);
      g.stroke({ width: 1.5, color: edge, alpha: edgeAlpha, join: 'round' });
      for (let i = 1; i < peaks.length - 1; i++) {
        const p = peaks[i];
        if (p.h < 12) continue;
        g.moveTo(p.x, HORIZON - p.h).lineTo(peaks[i - 1].x + (p.x - peaks[i - 1].x) * 0.5, MOUNTAIN_FOOT);
        g.moveTo(p.x, HORIZON - p.h).lineTo(p.x + (peaks[i + 1].x - p.x) * 0.5, MOUNTAIN_FOOT);
      }
      g.stroke({ width: 1, color: edge, alpha: edgeAlpha * 0.35 });
    };
    layer(this.farPeaks, lerpColor(SKY.mid, SKY.top, 0.55), PALETTE.accent2, 0.35);
    layer(this.nearPeaks, 0x12062a, PALETTE.accent, 0.7);
  }

  // Terrain heights per world row, sampled every TERRAIN.dx. A row keeps its
  // heights as it scrolls toward the camera, so each is computed once instead
  // of every frame (the noise was a large share of the title screen's CPU).
  private readonly heightRows = new Map<number, Float32Array>();
  private heightHalf = 0;

  /** Height at world-x `x` on world row `row` (x a multiple of TERRAIN.dx). */
  private heightAt(row: number, x: number): number {
    const k = Math.round(x / TERRAIN.dx) + this.heightHalf;
    let hs = this.heightRows.get(row);
    if (!hs) {
      hs = new Float32Array(this.heightHalf * 2 + 1).fill(NaN);
      this.heightRows.set(row, hs);
    }
    if (k < 0 || k >= hs.length) return this.terrainHeight(x, row * TERRAIN.dz);
    if (Number.isNaN(hs[k])) hs[k] = this.terrainHeight(x, row * TERRAIN.dz);
    return hs[k];
  }

  /** Terrain height: a flat valley down the middle, hills rising to the sides. */
  private terrainHeight(x: number, z: number): number {
    const ax = Math.abs(x);
    const side = Math.min(1, Math.max(0, (ax - 1.8) / 6));
    if (side <= 0) return 0;
    // Ridged noise folds the field into sharp crests: angular vector peaks
    // rather than rolling dunes.
    const ridge = (v: number): number => 1 - Math.abs(2 * v - 1);
    let n = ridge(valueNoise(x * 0.3, z * 0.3, 11));
    n += ridge(valueNoise(x * 0.75, z * 0.75, 12)) * 0.3;
    n /= 1.3;
    return side * Math.sqrt(side) * n * n * n * 2.6;
  }

  /**
   * Battlezone-style vector landscape. Rows are drawn far to near; each row
   * first fills the area between its ridge line and its own flat-ground line
   * with the floor colour, so nearer hills occlude the wireframe behind them
   * (painter's algorithm). Farther rows always project above a row's ground
   * line, so that band is all the occlusion needed — and it keeps overdraw to
   * the hills themselves.
   */
  private drawFloor(): void {
    const g = this.floor;
    g.clear();
    g.rect(0, MOUNTAIN_FOOT, SCREEN_W, SCREEN_H - MOUNTAIN_FOOT).fill(SKY.floor);

    const cx = VIEW_W / 2;
    const focal = SCREEN_H - HORIZON; // camera height 1, so z = 1 lands on the bottom edge
    const travel = this.t * TERRAIN.speed;
    const base = Math.floor(travel / TERRAIN.dz);
    const rows = Math.ceil(TERRAIN.zFar / TERRAIN.dz) + 4;
    const projX = (x: number, z: number): number => cx + (x * focal) / z;
    const projY = (h: number, z: number): number => HORIZON + ((1 - h) * focal) / z;
    const colStep = TERRAIN.dx * TERRAIN.colEvery;

    // Size the height cache for the widest (farthest) row; drop passed rows.
    const half = Math.ceil(((Math.max(cx, SCREEN_W - cx) + 40) * TERRAIN.zFar) / focal / TERRAIN.dx) + 4;
    if (half !== this.heightHalf) {
      this.heightHalf = half;
      this.heightRows.clear();
    }
    for (const row of this.heightRows.keys()) if (row < base) this.heightRows.delete(row);

    let prevRow = 0;
    let prevZ = 0;
    for (let i = rows; i >= 0; i--) {
      const row = base + i;
      const z = row * TERRAIN.dz - travel;
      if (z < TERRAIN.zNear || z > TERRAIN.zFar) continue;
      // Thin the far rows by world index, so the pattern holds while scrolling.
      const thin = z > TERRAIN.fogFar * 1.5 ? 4 : z > TERRAIN.fogFar ? 2 : 1;
      if (row % thin !== 0) continue;
      const fog = Math.max(0, Math.min(1, 1 - (z - TERRAIN.zNear) / (TERRAIN.fogFar - TERRAIN.zNear)));

      // World-x range visible on this row, padded a little past each edge.
      const xMin = ((-40 - cx) * z) / focal;
      const xMax = ((SCREEN_W + 40 - cx) * z) / focal;

      // Column struts back to the previous (farther) row.
      if (prevZ > 0) {
        for (let x = Math.ceil(xMin / colStep) * colStep; x <= xMax; x += colStep) {
          g.moveTo(projX(x, prevZ), projY(this.heightAt(prevRow, x), prevZ));
          g.lineTo(projX(x, z), projY(this.heightAt(row, x), z));
        }
        g.stroke({ width: 1, color: PALETTE.grid, alpha: 0.12 + fog * 0.3 });
      }

      // Distant rows get sparser samples: keep them ~10px apart on screen.
      const step = TERRAIN.dx * Math.max(1, Math.floor((10 * z) / (focal * TERRAIN.dx)));
      const pts: number[] = [];
      for (let x = Math.floor(xMin / step) * step; x <= xMax + step; x += step) {
        pts.push(projX(x, z), projY(this.heightAt(row, x), z));
      }

      const ground = projY(0, z);
      g.moveTo(pts[0], ground);
      for (let k = 0; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
      g.lineTo(pts[pts.length - 2], ground);
      g.closePath();
      g.fill(SKY.floor);

      g.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
      g.stroke({
        width: 1 + fog * 0.6,
        color: lerpColor(PALETTE.accent2, PALETTE.grid, 0.35 + fog * 0.65),
        alpha: 0.14 + fog * 0.5,
        // Round joins add a fan of triangles per vertex; at ~1px a bevel looks
        // the same and is far cheaper to rebuild every frame.
        join: 'bevel',
      });
      prevRow = row;
      prevZ = z;
    }
  }

  setVisible(visible: boolean): void {
    this.bgLayer.visible = visible;
    this.uiLayer.visible = visible;
  }
}
