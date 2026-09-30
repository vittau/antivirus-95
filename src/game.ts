import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  ABILITY_TIME,
  CAM_MAX,
  COLS,
  BLIND_TIME,
  FRIGHT_TIME,
  DAEMONS,
  EXTRA_LIFE_EVERY,
  FONT_FAMILY,
  MAX_LIVES,
  MAZE_OFFSET_X,
  MAZE_ZOOM,
  VIRUS_LIVES,
  PALETTE,
  PLAYER_LIVES,
  POWER_WARN,
  READY_TIME,
  QUARANTINE_CHAMBERS,
  RESPAWN_BANISH,
  ROWS,
  SCREEN_H,
  SCREEN_W,
  STANCE_ORDER,
  TILE,
  VIEW_W,
  WORLD_H,
  WORLD_W,
  themeForLevel,
} from './config';
import type { FieldTheme } from './config';
import { lerpColor } from './color';
import { levelFor } from './levels';
import { Maze, NavCache, WALL } from './maze';
import { centerOf } from './mover';
import { Daemon, Virus, threatField } from './actors';
import type { SimContext, SimFields } from './actors';
import {
  drawDaemon,
  drawDaemonSilhouette,
  drawFirewall,
  drawInfectedDisk,
  drawServerCore,
  drawSparkle,
  drawVirus,
} from './draw';
import { Fx } from './fx';
import { GameAudio } from './audio';
import { Hud } from './hud';
import type { HudState } from './hud';
import { HEADER_H, Menu } from './menu';
import { createBloom, createCRT } from './filters';
import type { CrtResult } from './filters';
import { DIRS } from './types';
import type { GamePhase, DaemonId, Stance, TilePos, UnitDir } from './types';
import type { Input, InputDevice } from './input';
import { desktop } from './desktop';
import { MusicPlayer } from './music';
import { lattice, valueNoise } from './noise';

// Bundled music (CC-BY 4.0 — see README for attribution).
import menuTrack from './assets/audio/01-falling-organ.mp3';
import levelTrack1 from './assets/audio/02-tyranny-of-the-sun.mp3';
import levelTrack2 from './assets/audio/03-work-in-progress.mp3';
import levelTrack3 from './assets/audio/04-demons-on-the-beach.mp3';
import levelTrack4 from './assets/audio/05-solitude.mp3';
import levelTrack5 from './assets/audio/06-the-climax.mp3';

/** Pause-screen entries: only the desktop build can quit from inside the game. */
const PAUSE_ITEMS: readonly string[] = desktop ? ['RESUME', 'QUIT GAME'] : [];

/** Title-screen demo camera: tiles visible top to bottom, and seconds per daemon. */
const DEMO_TILES_TALL = 11;
const DEMO_FOCUS_TIME = 5;
/** Redraw rate of the drifting wall texture (see drawWallDots). */
const WALL_DOTS_HZ = 20;
/** Motion-trail sampling interval (see drawTrails). */
const TRAIL_STEP = 1 / 60;
/** Trail points kept per actor, and the daemon silhouettes drawn from them. */
const TRAIL_LEN = 10;
const TRAIL_SHAPES = TRAIL_LEN / 2;
/** Daemon body radius, in world pixels. */
const DAEMON_R = TILE * 0.45;

/**
 * One daemon's trail: silhouettes sharing a single pre-built shape (moved,
 * scaled and tinted per point instead of re-tessellated every frame), and the
 * eyes' dots while it is eaten.
 */
interface DaemonTrail {
  shapes: Graphics[];
}

export class Game {
  private readonly app: Application;
  private readonly audio = new GameAudio();
  private readonly music = new MusicPlayer({
    menu: menuTrack,
    levels: [levelTrack1, levelTrack2, levelTrack3, levelTrack4, levelTrack5],
    names: [
      'FALLING ORGAN',
      'TYRANNY OF THE SUN',
      'WORK IN PROGRESS',
      'DEMONS ON THE BEACH',
      'SOLITUDE',
      'THE CLIMAX',
    ],
  });
  private readonly fx = new Fx();
  private readonly hud = new Hud();
  private readonly menu = new Menu();

  // Simulation.
  private readonly maze = new Maze();
  private readonly nav: NavCache;
  private readonly virus: Virus;
  private readonly daemons: Daemon[] = [];
  private playerDaemon!: Daemon;
  private playerId: DaemonId = 'volt';

  private stance: Stance = 'hunt';
  private frightTimer = 0;

  // Rules / progress.
  phase: GamePhase = 'menu';
  private score = 0;
  private high = 0;
  private level = 1;
  private lives = PLAYER_LIVES;
  /** Score that earns the next extra life; it only moves up, so points lost and won back don't pay twice. */
  private nextLifeAt = EXTRA_LIFE_EVERY;
  private virusLives = VIRUS_LIVES;
  /** Was the player's ability usable last frame? (For the "ready" cue.) */
  private abilityWasReady = true;
  /** Game over is decided; it lands once the current hit-stop ends. */
  private gameOverPending = false;

  // Timers.
  private readyTimer = 0;
  private dyingTimer = 0;
  private levelClearTimer = 0;
  private freezeTimer = 0;
  private msgTimer = 0;
  private sirenTimer = 0;
  private menuSelect = 0;
  private demoStanceTimer = 0;

  // Presentation.
  private readonly world = new Container();
  private readonly backdrop = new Graphics();
  private readonly floorGrid = new Graphics();
  private readonly floorGlow = new Graphics();
  /** This level's playfield colours. */
  private theme: FieldTheme = themeForLevel(1);
  private readonly mazeFill = new Graphics();
  private readonly mazeGfx = new Graphics();
  private readonly wallDots = new Graphics();
  private readonly dotGfx = new Graphics();
  private readonly sparkleGfx = new Graphics();
  private readonly powerGfx = new Graphics();
  private readonly doorGfx = new Graphics();
  /** The server core between the chambers: built once per maze. */
  private readonly serverGfx = new Graphics();
  /** Its blinking LEDs, redrawn per frame (a few pixels). */
  private readonly serverLedGfx = new Graphics();
  private readonly portalGfx = new Graphics();
  private readonly trailGfx = new Graphics();
  private readonly daemonTrails = new Map<DaemonId, DaemonTrail>();
  /** Per-tile glint phase for drawSparkles (a pure function of the tile). */
  private readonly sparkleSeed = Float64Array.from({ length: COLS * ROWS }, (_, i) => lattice(i, 7, 3));
  private readonly actorLayer = new Container();
  private readonly overlayGfx = new Graphics();
  private readonly intentGfx = new Graphics();
  private readonly virusView = new Graphics();
  /** HALT's FREEZE: the ice block around the virus and its NOT RESPONDING tag. */
  private readonly freezeView = new Container();
  private readonly freezeGfx = new Graphics();
  private readonly freezeTag = new Container();
  private readonly freezeTagBar = new Graphics();
  private readonly freezeTagText = new Text({
    text: 'NOT RESPONDING',
    style: { fontFamily: FONT_FAMILY, fontSize: 11, fill: PALETTE.bgDeep, align: 'center' },
  });
  private readonly playerRing = new Graphics();
  private readonly daemonViews = new Map<DaemonId, Graphics>();
  /** Recent on-screen positions per actor, newest last, for motion trails. */
  private readonly trails = new Map<string, Array<{ x: number; y: number }>>();
  private bloom = createBloom();
  private crt: CrtResult | null = null;
  private crtOn = true;
  private showFps = false;

  private dotsDirty = true;
  private elapsed = 0;
  private camY = 0;
  /** Title-screen demo: the framed area, the daemon in focus, and the camera. */
  private readonly demoMask = new Graphics();
  private demoFocus = 0;
  private demoFocusT = 0;
  private demoCam: { x: number; y: number } | null = null;
  private wallDotsWindow = -1;
  private wallDotsAt = 0;
  private trailClock = 0;
  /** Seconds each daemon has been in the quarantine, and its REBOOT bar span. */
  private readonly quarantineT = new Map<DaemonId, number>();
  private readonly quarantineSpan = new Map<DaemonId, number>();
  private muted = false;
  /** Last device the player used; prompts and hints are worded for it. */
  private device: InputDevice = 'keyboard';
  /** Highlighted entry of the pause menu (desktop build only). */
  private pauseSelect = 0;
  private lastFps = 60;
  private message = '';
  private submessage = '';
  private messageColor = PALETTE.gold;

  constructor(app: Application) {
    this.app = app;
    this.nav = new NavCache(this.maze);
    this.virus = new Virus(this.maze);
    this.high = this.loadHigh();

    for (const def of DAEMONS) {
      const g = new Daemon(this.maze, def);
      this.daemons.push(g);
      const view = new Graphics();
      this.daemonViews.set(def.id, view);
      this.actorLayer.addChild(view);
    }

    // Trails sit under every actor: each daemon's, then the virus's.
    const trailLayer = new Container();
    for (const def of DAEMONS) {
      // One shared shape per daemon: each trail keeps its owner's outline.
      const silhouette = new Graphics();
      drawDaemonSilhouette(silhouette, def.id, 0, 0, DAEMON_R, PALETTE.white, 1);
      const shapes = Array.from({ length: TRAIL_SHAPES }, () => new Graphics(silhouette.context));
      trailLayer.addChild(...shapes);
      this.daemonTrails.set(def.id, { shapes });
    }
    trailLayer.addChild(this.trailGfx);
    this.actorLayer.addChildAt(trailLayer, 0);
    // The FREEZE tag stays a constant screen size, so it is re-scaled per frame.
    this.freezeView.addChild(this.freezeGfx, this.freezeTag);
    this.freezeTag.addChild(this.freezeTagBar, this.freezeTagText);
    this.freezeTagText.anchor.set(0.5);
    this.freezeTagText.eventMode = 'none';
    this.actorLayer.addChild(this.playerRing, this.intentGfx, this.virusView, this.freezeView);
    this.world.addChild(
      this.floorGrid,
      this.floorGlow,
      this.mazeFill,
      this.wallDots,
      this.mazeGfx,
      this.serverGfx,
      this.serverLedGfx,
      this.portalGfx,
      this.dotGfx,
      this.sparkleGfx,
      this.powerGfx,
      this.doorGfx,
      this.actorLayer,
    );
    this.world.position.set(0, 0);

    this.buildMaze();
    this.buildBackdrop();
    this.layoutDemoMask();

    // Stage layering: menu background → world → HUD → menu UI → FPS → flash.
    app.stage.addChild(
      this.backdrop,
      this.menu.bgLayer,
      this.world,
      this.overlayGfx,
      this.hud.layer,
      this.menu.uiLayer,
      this.hud.fpsLayer,
      this.fx.flashLayer,
      this.demoMask,
    );
    this.fx.layer.visible = true;
    this.world.addChild(this.fx.layer);

    this.hud.layer.visible = false;

    try {
      this.crt = createCRT();
      app.stage.filters = [this.crt.filter];
      // Pin the pass to the full screen so the warp centre never depends on the
      // stage's content bounds.
      app.stage.filterArea = app.screen;
      this.crt.resize(app.renderer.width, app.renderer.height);
    } catch (err) {
      console.warn('[antivirus-95] CRT unavailable', err);
      this.crt = null;
    }
    this.world.filters = [this.bloom];

    this.selectDaemon(0);
    this.enterAttract();
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private selectDaemon(index: number): void {
    this.menuSelect = ((index % DAEMONS.length) + DAEMONS.length) % DAEMONS.length;
    this.playerId = DAEMONS[this.menuSelect].id;
    this.playerDaemon = this.daemons.find((g) => g.id === this.playerId) as Daemon;
  }

  private isWallTile(c: number, r: number): boolean {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    return this.maze.kindAt(c, r) === WALL;
  }

  /**
   * Corner-aware wall outline at a given inset, grouped by row so each row can
   * carry its own gradient colour. Returns [x1, y1, x2, y2] segments.
   *
   * A segment's end is pulled in to the inset point where the outline turns
   * convexly (that edge exists AND the diagonal tile is open), pushed out past
   * the tile boundary where it turns concavely (neighbour and diagonal are both
   * wall, so the perpendicular line sits `inset` beyond the boundary), and
   * otherwise runs to the boundary so straight runs stay continuous.
   */
  private wallSegments(inset: number): number[][][] {
    const isWall = (c: number, r: number): boolean => this.isWallTile(c, r);
    const end = (open: boolean, diagOpen: boolean, base: number, sign: number): number => {
      if (open && diagOpen) return base + sign * inset;
      if (!open && !diagOpen) return base - sign * inset;
      return base;
    };

    const rows: number[][][] = [];
    for (let r = 0; r < ROWS; r++) {
      const segs: number[][] = [];
      for (let c = 0; c < COLS; c++) {
        if (!isWall(c, r)) continue;
        const x = c * TILE;
        const y = r * TILE;
        const L = !isWall(c - 1, r);
        const R = !isWall(c + 1, r);
        const T = !isWall(c, r - 1);
        const B = !isWall(c, r + 1);
        const TL = !isWall(c - 1, r - 1);
        const TR = !isWall(c + 1, r - 1);
        const BL = !isWall(c - 1, r + 1);
        const BR = !isWall(c + 1, r + 1);

        if (T) segs.push([end(L, TL, x, 1), y + inset, end(R, TR, x + TILE, -1), y + inset]);
        if (B) segs.push([end(L, BL, x, 1), y + TILE - inset, end(R, BR, x + TILE, -1), y + TILE - inset]);
        if (L) segs.push([x + inset, end(T, TL, y, 1), x + inset, end(B, BL, y + TILE, -1)]);
        if (R) segs.push([x + TILE - inset, end(T, TR, y, 1), x + TILE - inset, end(B, BR, y + TILE, -1)]);
      }
      rows.push(segs);
    }
    return rows;
  }

  private strokeSegments(
    g: Graphics,
    rows: number[][][],
    width: number,
    alpha: number,
    tint: (base: number) => number = (c) => c,
  ): void {
    rows.forEach((segs, r) => {
      if (!segs.length) return;
      for (const [x1, y1, x2, y2] of segs) g.moveTo(x1, y1).lineTo(x2, y2);
      const col = tint(lerpColor(this.theme.top, this.theme.bottom, r / (ROWS - 1)));
      g.stroke({ width, color: col, alpha, cap: 'round', join: 'round' });
    });
  }

  /**
   * The maze and theme for `level` (both cycle through their lists), pellets
   * reset; the playfield is repainted when either changes.
   */
  private setupLevel(level: number): void {
    const def = levelFor(level);
    const theme = themeForLevel(level);
    const newMaze = def !== this.maze.level;
    if (newMaze) this.maze.load(def);
    else this.maze.resetDots();
    this.dotsDirty = true;
    this.dotTiles = null;
    this.nav.clear();
    if (!newMaze && theme === this.theme) return;
    this.theme = theme;
    this.buildMaze();
  }

  private buildMaze(): void {
    this.wallDotsWindow = -1; // the texture takes the theme's accent
    this.mazeFill.clear();
    this.mazeGfx.clear();
    // Solid fill, row-tinted for a vertical gradient.
    for (let r = 0; r < ROWS; r++) {
      const col = lerpColor(this.theme.fillTop, this.theme.fillBottom, r / (ROWS - 1));
      for (let c = 0; c < COLS; c++) {
        if (this.maze.kindAt(c, r) === WALL) {
          this.mazeFill.rect(c * TILE, r * TILE, TILE, TILE).fill(col);
        }
      }
    }

    // Faint circuit traces and pads on the wall interiors: the board is a
    // motherboard. Drawn once per level, into the same cached Graphics.
    const pad = 7;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.maze.kindAt(c, r) !== WALL) continue;
        const x = c * TILE;
        const y = r * TILE;
        const horiz = (c + r) % 2 === 0;
        const ax = horiz ? x + pad : x + TILE / 2;
        const ay = horiz ? y + TILE / 2 : y + pad;
        const bx = horiz ? x + TILE - pad : x + TILE / 2;
        const by = horiz ? y + TILE / 2 : y + TILE - pad;
        this.mazeFill.moveTo(ax, ay).lineTo(bx, by);
        this.mazeFill.circle(ax, ay, 1.4);
        this.mazeFill.circle(bx, by, 1.4);
      }
    }
    this.mazeFill.stroke({ width: 1, color: this.theme.accent, alpha: 0.12 });

    // Neon tubes: a soft halo, an inner "double wall" echo (the classic arcade
    // two-line look), the coloured tube itself and a warm core. Kept a notch
    // below full brightness: the walls fill the screen, and under the bloom a
    // white-hot tube outshines the actors, the disks and the doors.
    const outer = this.wallSegments(2);
    const inner = this.wallSegments(8);
    this.strokeSegments(this.mazeGfx, outer, 9, 0.05);
    this.strokeSegments(this.mazeGfx, inner, 1.5, 0.3);
    this.strokeSegments(this.mazeGfx, outer, 2.5, 0.82);
    this.strokeSegments(this.mazeGfx, outer, 1, 0.35, (c) => lerpColor(c, PALETTE.white, 0.45));

    // The server core between the two chambers: a dark rack, drawn once here
    // (its blinking LEDs are the only per-frame part, see drawServerLeds).
    this.serverGfx.clear();
    drawServerCore(this.serverGfx, 14 * TILE, 14.5 * TILE, 2 * TILE - 8, 3 * TILE - 10, this.theme.accent);

    this.buildFloor();
  }

  /**
   * The corridor floor: a faint synthwave grid (it scrolls, see drawFloorGrid)
   * plus light spilling off every neon wall onto the adjacent floor, and a warm
   * glow inside the quarantine. Walls are opaque, so the grid only shows
   * through the corridors.
   */
  private buildFloor(): void {
    const grid = this.floorGrid;
    grid.clear();
    for (let x = 0; x <= COLS; x++) grid.moveTo(x * TILE, -TILE).lineTo(x * TILE, WORLD_H + TILE);
    for (let y = -1; y <= ROWS + 1; y++) grid.moveTo(0, y * TILE).lineTo(WORLD_W, y * TILE);
    grid.stroke({ width: 1, color: this.theme.top, alpha: 0.075 });

    const glow = this.floorGlow;
    glow.clear();
    const spill = [3, 7, 12];
    for (let r = 0; r < ROWS; r++) {
      const col = lerpColor(this.theme.top, this.theme.bottom, r / (ROWS - 1));
      for (let c = 0; c < COLS; c++) {
        if (this.isWallTile(c, r)) continue;
        // Out-of-bounds tiles (the tunnel mouths) aren't walls: no spill there.
        const wallAt = (cc: number, rr: number): boolean => cc >= 0 && cc < COLS && this.isWallTile(cc, rr);
        const x = c * TILE;
        const y = r * TILE;
        for (const w of spill) {
          if (wallAt(c, r - 1)) glow.rect(x, y, TILE, w);
          if (wallAt(c, r + 1)) glow.rect(x, y + TILE - w, TILE, w);
          if (wallAt(c - 1, r)) glow.rect(x, y, w, TILE);
          if (wallAt(c + 1, r)) glow.rect(x + TILE - w, y, w, TILE);
        }
        glow.fill({ color: col, alpha: 0.045 });
      }
    }

    // Quarantine: a striped sunset behind each chamber's waiting daemons,
    // framed in the danger colour (drawn once per level, never per frame).
    const stripes = 9;
    for (const cx of [11, 15]) {
      const hx = cx * TILE;
      const hy = 13 * TILE;
      const hw = 2 * TILE;
      const hh = 3 * TILE;
      for (let i = 0; i < stripes; i++) {
        const t = i / (stripes - 1);
        const sh = hh / stripes;
        const gap = sh * 0.45 * t;
        glow.rect(hx, hy + i * sh + gap, hw, sh - gap).fill({
          color: lerpColor(PALETTE.sunMid, PALETTE.sunBot, t),
          alpha: 0.13 * (1 - t * 0.6),
        });
      }
      glow.roundRect(hx + 3, hy + 3, hw - 6, hh - 6, 5).stroke({
        width: 1.5,
        color: PALETTE.danger,
        alpha: 0.45,
      });
      glow.roundRect(hx + 7, hy + 7, hw - 14, hh - 14, 3).stroke({
        width: 1,
        color: PALETTE.danger,
        alpha: 0.25,
      });
    }
  }

  /**
   * Wall texture: one soft dot per wall tile whose size and position are driven
   * by slowly drifting value noise. Nearby dots share the field, so the walls
   * breathe in soft waves instead of flickering. Only tiles inside the camera
   * window are drawn, keeping the cost flat. The field drifts slowly, so it is
   * rebuilt at WALL_DOTS_HZ (or when the window gains a tile) rather than every
   * frame: rebuilding a thousand-odd circles was a big share of each frame.
   */
  private drawWallDots(): void {
    // The camera window in tiles, from the world transform (already set).
    const s = this.world.scale.x;
    const c0 = Math.max(0, Math.floor(-this.world.x / s / TILE) - 1);
    const c1 = Math.min(COLS, Math.ceil((VIEW_W - this.world.x) / s / TILE) + 1);
    const r0 = Math.max(0, Math.floor(-this.world.y / s / TILE) - 1);
    const r1 = Math.min(ROWS, Math.ceil((SCREEN_H - this.world.y) / s / TILE) + 1);
    const t = this.elapsed;
    const win = c0 + c1 * 64 + r0 * 4096 + r1 * 262144;
    if (win === this.wallDotsWindow && t - this.wallDotsAt < 1 / WALL_DOTS_HZ) return;
    this.wallDotsWindow = win;
    this.wallDotsAt = t;
    this.wallDots.clear();

    // The noise field itself drifts diagonally; the second octave adds detail.
    const driftX = t * 0.045;
    const driftY = t * 0.03;

    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        if (this.maze.kindAt(c, r) !== WALL) continue;

        // 2x2 sub-dots per tile (~17px apart) matches the original density.
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const fx = sx === 0 ? 0.28 : 0.72;
            const fy = sy === 0 ? 0.28 : 0.72;

            const nx = (c + fx) * 0.34 + driftX;
            const ny = (r + fy) * 0.34 + driftY;

            let n = valueNoise(nx, ny, 1);
            n += valueNoise(nx * 2.3, ny * 2.3, 2) * 0.45;
            n /= 1.45; // back to ~0..1

            // A slow global breath keeps it alive without ever feeling random.
            const breathe = 0.5 + 0.5 * Math.sin(t * 0.4 + (c * 0.7 + r * 0.9 + sx + sy));
            const k = n * 0.72 + breathe * 0.28;

            const ox = (valueNoise(nx + 5.3, ny, 3) - 0.5) * 3.5;
            const oy = (valueNoise(nx, ny + 7.1, 4) - 0.5) * 3.5;

            this.wallDots
              .circle(c * TILE + fx * TILE + ox, r * TILE + fy * TILE + oy, 0.7 + k * 1.5)
              .fill({ color: this.theme.accent, alpha: 0.05 + k * 0.09 });
          }
        }
      }
    }
  }

  /** Slow downward scroll of the floor grid — the synthwave road, underfoot. */
  private drawFloorGrid(): void {
    this.floorGrid.y = (this.elapsed * 5) % TILE;
    this.floorGrid.alpha = 0.8 + 0.2 * Math.sin(this.elapsed * 0.7);
  }

  /** A few pellets at a time flare into a brief four-point glint. */
  private drawSparkles(): void {
    const g = this.sparkleGfx;
    g.clear();
    const t = this.elapsed;
    for (let i = 0; i < this.maze.dots.length; i++) {
      if (this.maze.dots[i] !== 1) continue;
      const h = this.sparkleSeed[i];
      const s = Math.sin(t * (0.5 + h * 0.6) + h * 60);
      if (s < 0.99) continue;
      const k = (s - 0.99) / 0.01;
      const c = i % COLS;
      const r = (i / COLS) | 0;
      drawSparkle(g, centerOf(c), centerOf(r), TILE * 0.3 * k, PALETTE.white, 0.85 * k, t * 2);
    }
  }

  /** The wrap-around tunnel mouths: warp-gate stripes streaming outward. */
  private drawPortals(): void {
    const g = this.portalGfx;
    g.clear();
    for (const row of this.maze.tunnelRows) this.drawPortal(g, row * TILE);
  }

  private drawPortal(g: Graphics, y: number): void {
    const depth = TILE * 1.6;
    for (const side of [-1, 1]) {
      const edge = side < 0 ? 0 : WORLD_W;
      for (let i = 0; i < 4; i++) {
        const w = depth * (1 - i / 4);
        g.rect(side < 0 ? edge : edge - w, y + 4, w, TILE - 8).fill({ color: PALETTE.accent2, alpha: 0.035 });
      }
      for (let k = 0; k < 6; k++) {
        const p = (this.elapsed * 1.2 + k / 6) % 1;
        const x = edge - side * depth * (1 - p);
        g.rect(x - 1, y + 5, 2, TILE - 10).fill({ color: PALETTE.accent2, alpha: 0.5 * p });
      }
      g.rect(side < 0 ? edge : edge - 2, y + 2, 2, TILE - 4).fill({ color: PALETTE.white, alpha: 0.6 });
    }
  }

  /**
   * Full-canvas backdrop so the background is continuous edge to edge, behind
   * both the maze viewport and the side panel.
   */
  private buildBackdrop(): void {
    this.backdrop.clear();
    const bands = 48;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      this.backdrop
        .rect(0, t * SCREEN_H - 1, SCREEN_W, SCREEN_H / bands + 2)
        .fill(lerpColor(0x180a30, 0x2a1250, t));
    }
    // Faint horizon glow so the panel side isn't dead flat.
    this.backdrop.rect(0, SCREEN_H * 0.62 - 2, SCREEN_W, 4).fill({ color: PALETTE.horizon, alpha: 0.05 });
  }

  /**
   * Bits are small axis-aligned squares (6 px on a 35 px tile), each with a
   * square glow behind it. Squares only — a round pellet shape would read as the
   * old dot under bloom, so no circles here.
   */
  private rebuildDots(): void {
    this.dotGfx.clear();
    const half = TILE * 0.09;
    const glow = half * 1.9;
    for (let i = 0; i < this.maze.dots.length; i++) {
      if (this.maze.dots[i] !== 1) continue;
      const x = centerOf(i % COLS);
      const y = centerOf((i / COLS) | 0);
      this.dotGfx.rect(x - glow, y - glow, glow * 2, glow * 2).fill({ color: PALETTE.accent, alpha: 0.13 });
    }
    for (let i = 0; i < this.maze.dots.length; i++) {
      if (this.maze.dots[i] !== 1) continue;
      const x = centerOf(i % COLS);
      const y = centerOf((i / COLS) | 0);
      this.dotGfx.rect(x - half, y - half, half * 2, half * 2).fill(PALETTE.dot);
    }
  }

  // -------------------------------------------------------------------------
  // Flow
  // -------------------------------------------------------------------------

  private enterAttract(): void {
    this.phase = 'menu';
    this.setupLevel(1);
    this.demoCam = null;
    this.hud.layer.visible = false;
    this.menu.setVisible(true);
    for (const g of this.daemons) g.isPlayer = false;
    this.spawnRound();
    this.audio.stopMusic();
    this.message = '';
    this.submessage = '';
    this.syncMusic();
  }

  private startGame(): void {
    this.audio.resume();
    this.audio.uiConfirm();
    this.score = 0;
    this.level = 1;
    this.setupLevel(this.level);
    this.lives = PLAYER_LIVES;
    this.nextLifeAt = EXTRA_LIFE_EVERY;
    this.gameOverPending = false;
    this.virusLives = VIRUS_LIVES;
    for (const g of this.daemons) g.isPlayer = false;
    this.playerDaemon.isPlayer = true;
    this.hud.layer.visible = true;
    this.menu.setVisible(false);
    this.spawnRound();
    this.phase = 'ready';
    this.readyTimer = READY_TIME;
    this.audio.ready();
    this.syncMusic();
  }

  private spawnRound(): void {
    this.virus.spawn();
    for (const g of this.daemons) g.spawn(this.level);
    this.frightTimer = 0;
    this.virus.powered = false;
    this.abilityWasReady = true;
    this.openPellet = null;
    this.quarantineT.clear();
    this.quarantineSpan.clear();
    this.nav.clear();

    // Snap the camera so a round never opens with a long pan.
    const visibleH = SCREEN_H / MAZE_ZOOM;
    const focusY = (this.playerDaemon ? this.playerDaemon.py : this.virus.py) * 0.68 + this.virus.py * 0.32;
    this.camY = Math.max(0, Math.min(CAM_MAX, focusY - visibleH * 0.56));
  }

  private newLevel(): void {
    this.level++;
    this.setupLevel(this.level);
    this.virusLives = VIRUS_LIVES;
    this.spawnRound();
    this.phase = 'ready';
    this.readyTimer = READY_TIME;
    this.syncMusic();
  }

  private gameOver(): void {
    this.demoCam = null;
    this.setupLevel(1);
    this.gameOverPending = false;
    this.freezeTimer = 0;
    this.phase = 'gameover';
    this.audio.gameOver();
    this.saveHigh();
    this.hud.layer.visible = false;
    this.menu.setVisible(true);
    for (const g of this.daemons) g.isPlayer = false;
    this.spawnRound();
    this.fx.clear();
    this.syncMusic();
  }

  /** True while the attract title / game-over screen is showing. */
  private get isAttract(): boolean {
    return this.phase === 'menu' || this.phase === 'gameover';
  }

  /**
   * Called from the first user gesture so the browser lets audio play.
   * Must be wired to a keydown/pointerdown listener.
   */
  unlockAudio(): void {
    this.audio.resume();
    this.music.unlock();
    this.syncMusic();
  }

  /** Menu track on the title screen; the in-game playlist (never restarted) otherwise. */
  private syncMusic(): void {
    if (this.music.available) {
      this.audio.stopMusic();
      if (this.isAttract) this.music.playMenu();
      else this.music.playGame();
    } else if (this.isAttract) {
      this.audio.stopMusic();
    } else {
      this.audio.startMusic();
    }
  }

  private static readonly HIGH_KEY = 'antivirus95.high';

  private loadHigh(): number {
    try {
      return Number(localStorage.getItem(Game.HIGH_KEY)) || 0;
    } catch {
      /* storage unavailable (private mode): no saved score */
    }
    return 0;
  }

  private saveHigh(): void {
    if (this.score > this.high) {
      this.high = this.score;
      try {
        localStorage.setItem(Game.HIGH_KEY, String(this.high));
      } catch {
        /* ignore */
      }
    }
  }

  private flashMessage(text: string, sub: string, color: number, time = 1.4): void {
    this.message = text;
    this.submessage = sub;
    this.messageColor = color;
    this.msgTimer = time;
  }

  // -------------------------------------------------------------------------
  // Input-driven actions
  // -------------------------------------------------------------------------

  private setStance(s: Stance): void {
    if (this.stance === s) return;
    this.stance = s;
    this.audio.uiSelect();
  }

  private cycleStance(dir: number): void {
    const i = STANCE_ORDER.indexOf(this.stance);
    this.setStance(STANCE_ORDER[(i + dir + STANCE_ORDER.length) % STANCE_ORDER.length]);
  }

  private useAbility(): void {
    const g = this.playerDaemon;
    // Only while actively hunting. Being frightened, eaten, or waiting in the
    // quarantine locks the ability — that's the cost of the infected-disk reversal.
    if (!g || g.cooldown > 0 || g.state !== 'normal') return;
    g.cooldown = g.def.cooldown;
    this.audio.ability(g.def.ability);
    this.fx.ring(g.px, g.py, g.def.color, TILE * 1.8, 0.35, 2.5);
    switch (g.def.ability) {
      case 'dash':
        g.dashTimer = ABILITY_TIME;
        this.fx.burst(g.px, g.py, g.def.color, 22, { speed: 200, life: 0.5, size: 3 });
        break;
      case 'warp': {
        const m = g.mover;
        const d = m.dir !== 'none' ? m.dir : m.want;
        const dest = d === 'none' ? null : this.corridorEnd(g, d as UnitDir);
        if (!dest) break;
        this.fx.burst(g.px, g.py, g.def.color, 18, { speed: 180, life: 0.4, size: 3 });
        m.place(dest.x, dest.y, d);
        m.want = d;
        this.fx.flash(PALETTE.accent, 0.25, 0.2);
        this.fx.burst(g.px, g.py, g.def.color, 26, { speed: 220, life: 0.5, size: 3 });
        this.fx.ring(g.px, g.py, g.def.color, TILE * 1.8, 0.35, 2.5);
        break;
      }
      case 'phase':
        g.beginPhase();
        this.fx.burst(g.px, g.py, g.def.color, 18, { speed: 160, life: 0.5, size: 3 });
        break;
      case 'blind': {
        const p = this.virus;
        p.blind = BLIND_TIME;
        this.audio.alert();
        this.fx.ring(p.px, p.py, PALETTE.danger, TILE * 2.4, 0.4, 3);
        break;
      }
    }
  }

  /**
   * WARP: straight ahead to the far end of the corridor — the last tile before
   * a wall, ignoring side openings on the way. It follows the side portal like
   * any corridor, and lands one tile short of the virus rather than on or past
   * it, so it sets up a catch instead of making one.
   */
  private corridorEnd(g: Daemon, d: UnitDir): TilePos | null {
    const m = g.mover;
    const virus = [this.virus.mover.tile, this.virus.mover.nextTile];
    let cur = m.tile;
    let moved = false;
    for (let i = 0; i < COLS + ROWS && m.canEnterFrom(cur.x, cur.y, d); i++) {
      const next = { x: (cur.x + DIRS[d].x + COLS) % COLS, y: cur.y + DIRS[d].y };
      if (virus.some((p) => p.x === next.x && p.y === next.y)) break;
      cur = next;
      moved = true;
    }
    return moved ? cur : null;
  }

  private toggleCRT(): void {
    this.crtOn = !this.crtOn;
    if (this.crt) this.crt.filter.enabled = this.crtOn;
    this.audio.uiSelect();
  }

  private toggleFps(): void {
    this.showFps = !this.showFps;
    this.audio.uiSelect();
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  private dotTiles: TilePos[] | null = null;
  private openPellet: TilePos | null = null;

  /**
   * GUARD never covers one power pellet, so the virus always has one to go for.
   * It's picked at random each round, and again once it's eaten it.
   */
  private pickOpenPellet(): TilePos | null {
    const tiles = this.maze.powerTiles();
    const p = this.openPellet;
    if (!p || !tiles.some((t) => t.x === p.x && t.y === p.y)) {
      this.openPellet = tiles.length ? tiles[(Math.random() * tiles.length) | 0] : null;
    }
    return this.openPellet;
  }

  private dotTilesNow(): TilePos[] {
    if (!this.dotTiles) this.dotTiles = this.maze.allDotTiles();
    return this.dotTiles;
  }

  /** Pellet distance fields, kept until a pellet is eaten or comes back. */
  private pelletFields: { version: number; dot: Int32Array | null; power: Int32Array | null } = {
    version: -1,
    dot: null,
    power: null,
  };

  private computeFields(): SimFields {
    const threat = threatField(this.maze, this.daemons, this.level);
    const pf = this.pelletFields;
    if (pf.version !== this.maze.dotsVersion) {
      pf.version = this.maze.dotsVersion;
      pf.dot = this.maze.dotsLeft > 0 ? this.maze.field(this.dotTilesNow(), false) : null;
      pf.power = this.maze.powerLeft > 0 ? this.maze.field(this.maze.powerTiles(), false) : null;
    }
    return { threat, dot: pf.dot, power: pf.power };
  }

  private context(fields: SimFields): SimContext {
    return {
      maze: this.maze,
      nav: this.nav,
      virus: this.virus,
      daemons: this.daemons,
      fields,
      stance: this.stance,
      openPellet: this.pickOpenPellet(),
      playerId: this.playerId,
      level: this.level,
    };
  }

  private updateSim(dt: number, ctx: SimContext): void {
    this.virus.update(dt, ctx);
    for (const g of this.daemons) {
      if (g.state === 'frightened' || (g.state === 'leaving' && g.frightTimer > 0)) g.frightTimer = this.frightTimer;
      const wasEaten = g.state === 'eaten';
      g.update(dt, ctx);
      // Track the quarantine wait so the REBOOT bar can fill with it. A daemon
      // arriving home from DELETED waits RESPAWN_BANISH; a round start waits the
      // slot's own release delay.
      if (g.state === 'quarantine') {
        const t = this.quarantineT.get(g.id);
        if (t === undefined) {
          this.quarantineT.set(g.id, 0);
          this.quarantineSpan.set(g.id, wasEaten ? RESPAWN_BANISH : Math.max(0.001, g.slot.release));
        }
        this.quarantineT.set(g.id, (this.quarantineT.get(g.id) ?? 0) + dt);
      } else {
        this.quarantineT.delete(g.id);
        this.quarantineSpan.delete(g.id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase updates
  // -------------------------------------------------------------------------

  update(dt: number, input: Input): void {
    this.elapsed += dt;
    this.lastFps = 1 / Math.max(0.0001, dt);
    this.device = input.lastDevice;

    if (input.pressed('nextSong')) {
      this.music.cycle();
      this.audio.uiSelect();
    }
    if (input.justPressed('KeyC')) this.toggleCRT();
    if (input.justPressed('KeyF')) this.toggleFps();
    if (input.pressed('mute')) {
      this.muted = this.audio.toggleMute();
      this.music.setMuted(this.muted);
    }

    const sdt = dt * this.fx.timeScale;

    switch (this.phase) {
      case 'menu':
      case 'gameover':
        this.updateAttract(sdt, input);
        break;
      case 'ready':
        this.updateReady(sdt, input);
        break;
      case 'playing':
        this.updatePlaying(sdt, input);
        break;
      case 'dying':
        this.updateDying(sdt);
        break;
      case 'levelclear':
        this.updateLevelClear(sdt);
        break;
      case 'paused':
        this.updatePaused(input);
        break;
    }

    this.audio.updateMusic();
    this.music.update(dt);
    if (this.crt) {
      this.crt.update(this.elapsed);
      // Ease the CRT over the HUD panel (past its neon seam) so the small
      // text stays legible; the maze keeps the full effect.
      this.crt.calmFrom(this.hud.layer.visible ? (VIEW_W + 8) / SCREEN_W : 1);
    }

    this.render(dt);
    this.hud.update(this.hudState());
    input.clearPresses();
  }

  private updatePaused(input: Input): void {
    const items = PAUSE_ITEMS;
    let resume = input.pressed('pause') || input.pressed('back');
    if (items.length) {
      const step = (input.pressed('down') ? 1 : 0) - (input.pressed('up') ? 1 : 0);
      if (step) {
        this.pauseSelect = (this.pauseSelect + step + items.length) % items.length;
        this.audio.uiSelect();
      }
      if (!resume && input.pressed('confirm')) {
        if (items[this.pauseSelect] === 'QUIT GAME') {
          desktop?.quit();
          return;
        }
        resume = true;
      }
    } else if (input.pressed('confirm')) {
      resume = true;
    }
    if (resume) {
      this.phase = 'playing';
      this.music.setDucked(false);
    }
  }

  private updateAttract(dt: number, input: Input): void {
    if (input.pressed('up')) {
      this.selectDaemon(this.menuSelect - 1);
      this.audio.uiSelect();
    }
    if (input.pressed('down')) {
      this.selectDaemon(this.menuSelect + 1);
      this.audio.uiSelect();
    }
    for (let i = 0; i < DAEMONS.length; i++) {
      if (input.justPressed(`Digit${i + 1}`)) {
        this.selectDaemon(i);
        this.audio.uiSelect();
      }
    }
    if (input.pressed('confirm')) {
      this.startGame();
      return;
    }

    // Live demo: all four daemons hunt, stances rotate.
    this.demoStanceTimer -= dt;
    if (this.demoStanceTimer <= 0) {
      this.demoStanceTimer = 5 + Math.random() * 3;
      this.stance = STANCE_ORDER[(Math.random() * STANCE_ORDER.length) | 0];
      if (Math.random() < 0.5) this.stance = 'hunt';
    }

    this.virus.powered = this.frightTimer > 0;
    if (this.frightTimer > 0) {
      this.frightTimer -= dt;
      if (this.frightTimer <= 0) this.virus.powered = false;
    }

    const ctx = this.context(this.computeFields());
    this.updateSim(dt, ctx);
    this.resolveDots(dt);
    this.resolveCollisions(true);

    if (this.maze.dotsLeft <= 0) {
      this.maze.resetDots();
      this.dotsDirty = true;
      this.dotTiles = null;
    }

    this.menu.update(
      dt,
      this.menuSelect,
      this.high,
      this.phase === 'gameover' ? 'gameover' : 'menu',
      this.audioHintText(),
      this.muted,
      this.device,
    );
    this.hud.layer.visible = false;
  }

  private updateReady(dt: number, input: Input): void {
    this.readyTimer -= dt;
    this.message = 'READY!';
    this.submessage = `LEVEL ${this.level}  ·  QUARANTINE THE VIRUS ${this.virusLives}×`;
    this.messageColor = PALETTE.gold;
    if (this.readyTimer <= 0) {
      this.phase = 'playing';
      this.message = '';
      this.submessage = '';
    }
    // Let the player pre-steer during the countdown.
    if (this.playerDaemon.state !== 'quarantine') {
      this.playerDaemon.mover.want = input.wantDir;
    }
  }

  private updatePlaying(dt: number, input: Input): void {
    // --- Controls ---
    // Banished eyes (state 'eaten') find their own way home, wait in the quarantine,
    // then walk themselves out of the door ('leaving'); input resumes outside.
    const pg = this.playerDaemon;
    if (pg.state === 'normal' || pg.state === 'frightened') pg.mover.want = input.wantDir;

    if (input.justPressed('Digit1')) this.setStance('hunt');
    if (input.justPressed('Digit2')) this.setStance('ambush');
    if (input.justPressed('Digit3')) this.setStance('flank');
    if (input.justPressed('Digit4')) this.setStance('guard');
    if (input.pressed('stanceNext')) this.cycleStance(1);
    if (input.pressed('stancePrev')) this.cycleStance(-1);
    if (input.pressed('ability')) this.useAbility();
    if (input.pressed('pause')) {
      this.phase = 'paused';
      this.pauseSelect = 0;
      this.music.setDucked(true);
      return;
    }

    // --- Timers ---
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) {
        this.message = '';
        this.submessage = '';
      }
    }

    if (this.frightTimer > 0) {
      this.frightTimer = Math.max(0, this.frightTimer - dt);
      if (this.frightTimer === 0) this.virus.powered = false;
    }

    // Hit-stop after a big moment: the simulation holds while the effects
    // play on (update() renders the frame, effects included, once).
    if (this.freezeTimer > 0) {
      this.freezeTimer -= dt;
      if (this.freezeTimer <= 0 && this.gameOverPending) this.gameOver();
      return;
    }

    // --- Sim ---
    this.virus.powered = this.frightTimer > 0;
    const ctx = this.context(this.computeFields());
    this.updateSim(dt, ctx);
    if (pg.phaseEjected) {
      pg.phaseEjected = false;
      this.fx.burst(pg.px, pg.py, pg.def.color, 22, { speed: 200, life: 0.5, size: 3 });
      this.fx.ring(pg.px, pg.py, pg.def.color, TILE * 1.8, 0.35, 2.5);
    }
    this.resolveDots(dt);
    if (this.gameOverPending) return;
    this.resolveCollisions(false);

    // The ability just came back (cooldown over, or back from banishment).
    const ready = pg.cooldown <= 0 && pg.state === 'normal';
    if (ready && !this.abilityWasReady) {
      this.audio.abilityReady();
      this.hud.flashAbility();
      this.fx.ring(pg.px, pg.py, pg.def.color, TILE * 1.3, 0.4, 2);
    }
    this.abilityWasReady = ready;

    // Siren pitch tracks how close the virus is to clearing the board.
    this.sirenTimer -= dt;
    if (this.sirenTimer <= 0) {
      this.sirenTimer = 0.55;
      const eaten = 1 - this.maze.dotsLeft / Math.max(1, this.maze.dotsTotal);
      this.audio.siren(eaten);
    }
  }

  private updateDying(dt: number): void {
    this.dyingTimer -= dt;
    this.virus.deathT += dt;
    this.message = 'QUARANTINED!';
    this.messageColor = PALETTE.gold;
    if (this.dyingTimer <= 0) {
      this.spawnRound();
      this.phase = 'ready';
      this.readyTimer = READY_TIME;
    }
  }

  private updateLevelClear(dt: number): void {
    this.levelClearTimer -= dt;
    this.message = 'LEVEL CLEAR!';
    this.submessage = `ALL ${VIRUS_LIVES} QUARANTINES MADE`;
    this.messageColor = PALETTE.accent2;
    if (this.levelClearTimer <= 0) this.newLevel();
  }

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  private resolveDots(dt: number): void {
    // Eaten power pellets come back in time, so camping the last one can't
    // keep it from ever powering up again.
    for (const p of this.maze.tickRespawns(dt, this.virus.mover.tile)) {
      this.dotTiles = null;
      this.fx.ring(centerOf(p.x), centerOf(p.y), PALETTE.power, TILE * 1.6, 0.5, 2);
    }

    // The virus eats the pellet under its current tile.
    if (!this.virus.alive) return;
    const t = this.virus.mover.tile;
    const v = this.maze.eat(t.x, t.y);
    if (v === 0) return;

    this.dotsDirty = true;
    this.dotTiles = null;
    this.audio.bitEaten();

    if (v === 2) {
      this.frightTimer = FRIGHT_TIME;
      this.virus.powered = true;
      for (const g of this.daemons) g.frighten();
      this.audio.powerUp();
      this.fx.flash(PALETTE.power, 0.35, 0.3);
      this.fx.shake(5, 0.3);
      this.fx.ring(this.virus.px, this.virus.py, PALETTE.power, TILE * 5, 0.7, 4);
      this.flashMessage('EXPLOIT LOADED!', 'THE VIRUS HUNTS YOU', PALETTE.power, 1.4);
    } else {
      this.fx.burst(this.virus.px, this.virus.py, PALETTE.dot, 5, {
        speed: 70,
        life: 0.3,
        size: 2,
        grav: 0,
      });
    }

    if (this.maze.dotsLeft <= 0) this.virusEscaped();
  }

  /** The virus cleared the maze: that's the game, however many lives are left. */
  private virusEscaped(): void {
    this.audio.banished();
    this.fx.flash(PALETTE.danger, 0.45, 0.4);
    this.flashMessage('SYSTEM COMPROMISED', 'GAME OVER', PALETTE.danger, 1.6);
    this.gameOverPending = true;
    this.freezeTimer = 1.6;
  }

  private addScore(pts: number): void {
    this.score += pts;
    this.saveHigh();
    while (this.score >= this.nextLifeAt) {
      this.nextLifeAt += EXTRA_LIFE_EVERY;
      if (this.lives < MAX_LIVES) {
        this.lives++;
        const g = this.playerDaemon;
        this.fx.pop('1UP', g.px, g.py - 26, PALETTE.gold, 16);
      }
    }
  }

  private resolveCollisions(demo: boolean): void {
    if (!this.virus.alive) return;
    const reach = TILE * 0.55;

    for (const g of this.daemons) {
      if (this.gameOverPending) return;
      const d = Math.hypot(g.px - this.virus.px, g.py - this.virus.py);

      if (this.frightTimer > 0 && g.state === 'frightened') {
        if (d < reach) this.deleteDaemon(g, demo);
        continue;
      }

      if (g.isDangerous() && d < reach) {
        if (demo) {
          this.demoReset();
        } else {
          this.onVirusCaught();
        }
        return;
      }
    }
  }

  private demoReset(): void {
    this.fx.burst(this.virus.px, this.virus.py, PALETTE.virus, 30, { speed: 220, life: 0.7, size: 4 });
    this.fx.ring(this.virus.px, this.virus.py, PALETTE.virus, TILE * 3, 0.5, 3);
    this.spawnRound();
  }

  private onVirusCaught(): void {
    const pts = 200 * this.level;
    this.addScore(pts);
    this.audio.virusQuarantined();
    this.fx.flash(PALETTE.gold, 0.55, 0.25);
    this.fx.shake(10, 0.5);
    this.fx.burst(this.virus.px, this.virus.py, PALETTE.virus, 44, { speed: 280, life: 0.8, size: 4 });
    this.fx.ring(this.virus.px, this.virus.py, PALETTE.gold, TILE * 4, 0.6, 4);
    this.fx.ring(this.virus.px, this.virus.py, PALETTE.accent, TILE * 2.4, 0.45, 2);
    this.fx.pop(`+${pts}`, this.virus.px, this.virus.py - 24, PALETTE.gold, 20);

    this.virus.alive = false;
    this.virus.deathT = 0;
    this.virusLives--;

    if (this.virusLives <= 0) {
      this.message = 'LEVEL CLEAR!';
      this.messageColor = PALETTE.accent2;
      this.phase = 'levelclear';
      this.levelClearTimer = 2.6;
      this.audio.levelClear();
    } else {
      this.message = 'QUARANTINED!';
      this.messageColor = PALETTE.gold;
      this.phase = 'dying';
      this.dyingTimer = 1.3;
    }
  }

  private deleteDaemon(g: Daemon, demo: boolean): void {
    g.beginDeleted();

    this.audio.daemonDeleted();
    this.fx.shake(7, 0.4);
    this.fx.flash(PALETTE.power, 0.4, 0.22);
    this.fx.burst(g.px, g.py, g.def.color, 30, { speed: 240, life: 0.7, size: 4 });
    this.fx.ring(g.px, g.py, PALETTE.power, TILE * 2.6, 0.5, 3);
    this.freezeTimer = demo ? 0 : 0.35;

    // The attract-mode demo runs the real simulation but must never touch the
    // player's score, lives or the persisted high score.
    if (g.isPlayer && !demo) {
      this.score = Math.max(0, this.score - 100);
      this.lives--;
      this.fx.pop('-1 LIFE', g.px, g.py - 18, PALETTE.danger, 16);
      if (this.lives <= 0) {
        this.flashMessage('DELETED!', 'NO LIVES LEFT', PALETTE.danger, 1.6);
        this.gameOverPending = true;
        this.freezeTimer = 1.6;
      } else {
        const left = `${this.lives} ${this.lives === 1 ? 'LIFE' : 'LIVES'} LEFT`;
        this.flashMessage("YOU'RE DELETED!", left, PALETTE.danger, 2);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** The title-screen demo's frame: below the header, left of the panel. */
  private layoutDemoMask(): void {
    this.demoMask.clear().rect(0, HEADER_H, VIEW_W, SCREEN_H - HEADER_H).fill(PALETTE.white);
  }

  /** The daemon the title-screen camera follows: a new one every few seconds. */
  private demoTarget(dt: number): { x: number; y: number } {
    const outside = (g: Daemon): boolean => g.state !== 'quarantine';
    this.demoFocusT -= dt;
    if (this.demoFocusT <= 0 || !outside(this.daemons[this.demoFocus])) {
      this.demoFocusT = DEMO_FOCUS_TIME;
      for (let i = 1; i <= this.daemons.length; i++) {
        const j = (this.demoFocus + i) % this.daemons.length;
        if (outside(this.daemons[j])) {
          this.demoFocus = j;
          break;
        }
      }
    }
    const g = this.daemons[this.demoFocus];
    return { x: g.px, y: g.py };
  }

  private render(dt: number): void {
    const shake = this.fx.updateShake(dt);
    const demo = this.phase === 'menu' || this.phase === 'gameover';

    if (demo) {
      // Title screen: a close shot that drifts from daemon to daemon, framed in
      // the space below the header and left of the panel.
      const viewH = SCREEN_H - HEADER_H;
      const scale = viewH / (DEMO_TILES_TALL * TILE);
      const focus = this.demoTarget(dt);
      const clampAxis = (v: number, half: number, size: number): number =>
        half * 2 >= size ? size / 2 : Math.max(half, Math.min(size - half, v));
      const tx = clampAxis(focus.x, VIEW_W / 2 / scale, WORLD_W);
      const ty = clampAxis(focus.y, viewH / 2 / scale, WORLD_H);
      // Snap on the first frame and across the tunnel wrap; glide otherwise.
      if (!this.demoCam || Math.abs(tx - this.demoCam.x) > WORLD_W / 2) this.demoCam = { x: tx, y: ty };
      const k = Math.min(1, dt * 3);
      this.demoCam.x += (tx - this.demoCam.x) * k;
      this.demoCam.y += (ty - this.demoCam.y) * k;
      this.world.alpha = 0.8;
      this.world.scale.set(scale);
      this.world.position.set(
        VIEW_W / 2 - this.demoCam.x * scale + shake.x,
        HEADER_H + viewH / 2 - this.demoCam.y * scale + shake.y,
      );
      this.demoMask.visible = true;
      this.world.mask = this.demoMask;
    } else {
      // Out of use as a mask it would draw as a plain white rectangle.
      this.world.mask = null;
      this.demoMask.visible = false;
      // Vertically scrolling camera: frame the player and the virus together.
      const visibleH = SCREEN_H / MAZE_ZOOM;
      const focusY = this.playerDaemon.py * 0.68 + this.virus.py * 0.32;
      const target = Math.max(0, Math.min(CAM_MAX, focusY - visibleH * 0.56));
      this.camY += (target - this.camY) * Math.min(1, dt * 5.5);
      this.world.alpha = 1;
      this.world.scale.set(MAZE_ZOOM);
      this.world.position.set(MAZE_OFFSET_X + shake.x, -this.camY * MAZE_ZOOM + shake.y);
    }

    if (this.dotsDirty) {
      this.rebuildDots();
      this.dotsDirty = false;
    }
    // Drift the wall texture for a subtle living surface.
    this.drawWallDots();
    this.drawFloorGrid();
    this.drawSparkles();
    this.drawPortals();
    this.drawPower();
    this.drawDoorGfx();
    this.drawServerLeds();
    this.drawTrails(dt);
    this.drawVirusView();
    this.drawFreeze();
    for (const g of this.daemons) this.drawDaemonView(g);
    this.drawPlayerRing();
    this.drawIntent();
    this.drawOffscreenArrow();

    this.fx.update(dt);
  }

  /** Edge arrow pointing at the virus when it scrolls out of view. */
  private drawOffscreenArrow(): void {
    this.overlayGfx.clear();
    if (this.phase === 'menu' || this.phase === 'gameover' || !this.virus.alive) return;

    const sy = (this.virus.py - this.camY) * MAZE_ZOOM;
    const sx = this.virus.px * MAZE_ZOOM + MAZE_OFFSET_X;
    const pad = 22;
    if (sy >= pad && sy <= SCREEN_H - pad) return;

    const top = sy < pad;
    const y = top ? pad : SCREEN_H - pad;
    const x = Math.max(40, Math.min(VIEW_W - 40, sx));
    const dir = top ? -1 : 1;

    this.overlayGfx.moveTo(x, y + dir * 9);
    this.overlayGfx.lineTo(x - 13, y - dir * 6);
    this.overlayGfx.lineTo(x + 13, y - dir * 6);
    this.overlayGfx.closePath();
    this.overlayGfx.fill({ color: PALETTE.virus, alpha: 0.92 });
    this.overlayGfx
      .circle(x, y - dir * 18, 5)
      .fill({ color: PALETTE.virus, alpha: 0.55 });
  }

  private drawPower(): void {
    this.powerGfx.clear();
    const g = this.powerGfx;
    const a = 0.85 + 0.15 * Math.sin(this.elapsed * 6);
    const s = TILE * 0.028;
    for (let i = 0; i < this.maze.dots.length; i++) {
      if (this.maze.dots[i] !== 2) continue;
      const x = centerOf(i % COLS);
      const y = centerOf((i / COLS) | 0);
      // The INFECTED DISK: a floppy carrying the virus, with a pulsing glow.
      drawInfectedDisk(g, x, y, s * (0.95 + 0.06 * a), 0.6 + 0.4 * a);
      drawSparkle(g, x, y, TILE * 0.42, PALETTE.white, 0.3 + 0.2 * a, this.elapsed * 0.8);
    }
    // A spot about to get its disk back blinks, faster in the last seconds.
    for (const p of this.maze.respawns) {
      if (p.t > POWER_WARN || Math.floor(p.t * (p.t < 2 ? 8 : 4)) % 2) continue;
      const x = centerOf(p.x);
      const y = centerOf(p.y);
      g.circle(x, y, TILE * 0.2).fill({ color: PALETTE.danger, alpha: 0.7 });
      g.circle(x, y, TILE * 0.36).stroke({ width: 2, color: PALETTE.danger, alpha: 0.8 });
    }
  }

  private drawDoorGfx(): void {
    const g = this.doorGfx;
    g.clear();
    const a = 0.7 + 0.3 * Math.sin(this.elapsed * 4);
    for (const ch of QUARANTINE_CHAMBERS) {
      // A vertical firewall across each side door, flames toward the ring.
      const outward = ch.door.x < COLS / 2 ? -1 : 1;
      drawFirewall(g, centerOf(ch.door.x), centerOf(ch.door.y), TILE, TILE * 0.26, a, outward);
    }
  }

  /** The server core's blinking status LEDs (a few pixels, drawn per frame). */
  private drawServerLeds(): void {
    const g = this.serverLedGfx;
    g.clear();
    const lx = 13 * TILE + TILE * 0.5;
    const rows = [13.45, 14.0, 14.55];
    const colors = [PALETTE.accent2, PALETTE.virus, PALETTE.gold];
    for (let i = 0; i < rows.length; i++) {
      if (Math.sin(this.elapsed * (1.6 + i * 0.7) + i * 2.1) < -0.15) continue;
      g.rect(lx - 2, rows[i] * TILE - 2, 4, 4).fill({ color: colors[i], alpha: 0.9 });
    }
  }

  private drawVirusView(): void {
    const g = this.virusView;
    g.clear();
    if (!this.virus.alive) {
      // Quarantined: shatter into pixels between closing brackets.
      drawVirus(g, TILE * 0.46, { dying: true, deathT: this.virus.deathT / 1.1 });
      g.position.set(this.virus.px, this.virus.py);
      return;
    }
    const powered = this.virus.powered;
    const frozen = this.virus.blind > 0;
    drawVirus(g, TILE * 0.46, {
      mouth: this.virus.mouth,
      dir: this.virus.mover.dir,
      powered: powered && !frozen,
      frozen,
      spin: this.elapsed * 0.5,
    });
    // EXPLOIT: a red hunter aura so the reversal reads instantly. On a close
    // chase it runs hotter and wider.
    if (powered) {
      const fury = this.virus.furious;
      const pulse = 0.6 + 0.4 * Math.sin(this.elapsed * (fury ? 26 : 12));
      const grow = fury ? 1.12 : 1;
      g.circle(0, 0, TILE * 0.62 * grow).stroke({
        width: fury ? 3.5 : 2.5,
        color: PALETTE.danger,
        alpha: 0.35 + 0.4 * pulse,
      });
      g.circle(0, 0, TILE * 0.78 * grow).stroke({
        width: fury ? 2.5 : 1.5,
        color: PALETTE.danger,
        alpha: 0.15 + 0.25 * pulse,
      });
    }
    g.position.set(this.virus.px, this.virus.py);
  }

  /**
   * HALT's FREEZE: the virus sits in a translucent ice block with an "O" mouth
   * and a NOT RESPONDING tag. Pop-in overshoot, a slight bob, a flicker out.
   */
  private drawFreeze(): void {
    const g = this.freezeGfx;
    g.clear();
    const left = this.virus.blind;
    let visible = left > 0 && this.virus.alive;
    if (visible && left < 0.4 && Math.floor(left * 16) % 2 === 0) visible = false;
    this.freezeView.visible = visible;
    if (!visible) return;
    this.freezeView.position.set(this.virus.px, this.virus.py);

    const age = BLIND_TIME - left;
    // Pop: 0 → 1.15 → 1 over the first 0.18s.
    const k = Math.min(1, age / 0.18);
    const scale = k < 0.6 ? (k / 0.6) * 1.15 : 1.15 - ((k - 0.6) / 0.4) * 0.15;
    const bob = Math.sin(age * 9) * 1.2;
    const w = TILE * 1.3 * scale;
    const h = TILE * 1.45 * scale;
    const top = -h / 2 + bob;

    g.roundRect(-w / 2, top, w, h, 5)
      .fill({ color: PALETTE.ice, alpha: 0.34 })
      .stroke({ width: 1, color: PALETTE.iceEdge, alpha: 0.9 });
    // Diagonal shine.
    g.moveTo(-w * 0.3, top + h * 0.28)
      .lineTo(-w * 0.1, top + h * 0.08)
      .moveTo(-w * 0.34, top + h * 0.55)
      .lineTo(w * 0.02, top + h * 0.12)
      .moveTo(w * 0.28, top + h * 0.78)
      .lineTo(w * 0.12, top + h * 0.9)
      .stroke({ width: 1.4, color: PALETTE.white, alpha: 0.7, cap: 'round' });

    // The tag lives in screen space so it stays legible at any maze zoom.
    const inv = 1 / Math.max(0.0001, this.world.scale.x);
    this.freezeTag.scale.set(inv);
    this.freezeTag.position.set(0, top - 13 * inv);
    const tw = this.freezeTagText.width + 16;
    this.freezeTagBar.clear();
    this.freezeTagBar.roundRect(-tw / 2, -9, tw, 18, 3).fill({ color: PALETTE.gold, alpha: 0.96 });
    this.freezeTagBar.roundRect(-tw / 2, -9, tw, 18, 3).stroke({
      width: 1,
      color: PALETTE.bgDeep,
      alpha: 0.85,
    });
  }

  private drawDaemonView(g: Daemon): void {
    const view = this.daemonViews.get(g.id);
    if (!view) return;
    view.clear();
    const frightened = g.state === 'frightened';
    const eaten = g.state === 'eaten';
    const quarantined = g.state === 'quarantine';
    const r = DAEMON_R;
    const body = frightened ? PALETTE.corrupted : g.def.color;
    if (!eaten && !quarantined) {
      // Neon light pooling on the floor beneath the daemon.
      view.ellipse(0, r * 1.16, r * 0.85, r * 0.2).fill({ color: body, alpha: 0.22 });
    }
    if (g.mover.phase && !eaten) {
      // PHASE: the daemon de-syncs into chromatic images while in the wall.
      const j = Math.sin(this.elapsed * 40) * 1.5;
      drawDaemonSilhouette(view, g.id, -3 + j, 0, r, PALETTE.accent, 0.45);
      drawDaemonSilhouette(view, g.id, 3 - j, 0, r, PALETTE.accent2, 0.45);
    }
    const span = this.quarantineSpan.get(g.id) ?? 0.001;
    drawDaemon(view, r, {
      color: g.def.color,
      colorDark: g.def.colorDark,
      id: g.id,
      dir: g.mover.dir,
      frightened,
      flash: g.flash,
      eaten,
      quarantine: quarantined,
      respawn: (this.quarantineT.get(g.id) ?? 0) / span,
      ability: g.dashTimer > 0 || g.mover.phase,
      phase: g.mover.phase,
    });
    view.position.set(g.px, g.py);
    view.alpha = eaten
      ? 0.8
      : quarantined
        ? 0.9
        : g.mover.phase
          ? g.phaseBlink
            ? 0.15
            : 0.7
          : 1;
  }

  /**
   * Motion trails. Every actor leaves a faint long-exposure smear; OVERCLOCK
   * and a powered virus leave a bright one (red when it's furious). Samples that
   * jump (tunnel wrap, blink, respawn) break the trail instead of streaking
   * across the board.
   */
  private drawTrails(dt: number): void {
    const g = this.trailGfx;
    g.clear();
    const LEN = TRAIL_LEN;
    // Sampled at 60 Hz on average whatever the refresh rate, so a trail spans
    // the same time (and length) on a 120 Hz screen as on a 60 Hz one. The 10%
    // slack keeps frame-time jitter at 60 Hz from skipping samples.
    this.trailClock += dt;
    const due = this.trailClock >= TRAIL_STEP * 0.9;
    if (due) this.trailClock = Math.max(0, this.trailClock - TRAIL_STEP);
    const sample = (key: string, x: number, y: number): Array<{ x: number; y: number }> => {
      let pts = this.trails.get(key);
      if (!pts) {
        pts = [];
        this.trails.set(key, pts);
      }
      const last = pts[pts.length - 1];
      if (last && Math.hypot(last.x - x, last.y - y) > TILE * 1.5) pts.length = 0;
      if (due || !pts.length) {
        pts.push({ x, y });
        if (pts.length > LEN) pts.shift();
      }
      return pts;
    };

    for (const gh of this.daemons) {
      const pts = sample(gh.id, gh.px, gh.py);
      const trail = this.daemonTrails.get(gh.id) as DaemonTrail;
      let used = 0;
      if (gh.state !== 'quarantine') {
        const dashing = gh.dashTimer > 0;
        const color = gh.state === 'frightened' ? PALETTE.corrupted : gh.def.color;
        for (let i = 0; i < pts.length - 1; i += 2) {
          const k = (i + 1) / pts.length;
          const p = pts[i];
          const shape = trail.shapes[used++];
          shape.position.set(p.x, p.y);
          shape.scale.set(0.8 + 0.2 * k);
          shape.tint = dashing ? lerpColor(color, PALETTE.white, 0.35) : color;
          shape.alpha = (dashing ? 0.34 : 0.07) * k;
        }
      }
      for (let i = 0; i < trail.shapes.length; i++) trail.shapes[i].visible = i < used;
    }

    const pts = sample('virus', this.virus.px, this.virus.py);
    if (!this.virus.alive) return;
    const powered = this.virus.powered;
    const color = powered ? PALETTE.danger : PALETTE.virus;
    for (let i = 0; i < pts.length - 1; i++) {
      const k = (i + 1) / pts.length;
      const p = pts[i];
      g.circle(p.x, p.y, TILE * 0.4 * (0.55 + 0.45 * k)).fill({
        color,
        alpha: (powered ? 0.16 : 0.05) * k,
      });
    }
  }

  private drawPlayerRing(): void {
    this.playerRing.clear();
    if (this.phase === 'menu' || this.phase === 'gameover') return;
    const g = this.playerDaemon;
    if (!g) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 5);
    this.playerRing.circle(g.px, g.py, TILE * 0.82).stroke({
      width: 2.5,
      color: g.def.color,
      alpha: 0.4 + 0.35 * pulse,
    });
  }

  private drawIntent(): void {
    this.intentGfx.clear();
    const show = this.phase === 'playing' || this.phase === 'ready' || this.phase === 'menu' || this.phase === 'gameover';
    if (!show) return;

    for (const g of this.daemons) {
      if (g.isPlayer) continue;
      if (g.state === 'eaten' || g.state === 'quarantine') continue;
      const tx = centerOf(g.lastTarget.x);
      const ty = centerOf(g.lastTarget.y);
      this.intentGfx.moveTo(g.px, g.py).lineTo(tx, ty);
      this.intentGfx.stroke({ width: 1, color: g.def.color, alpha: 0.14 });
      this.intentGfx.circle(tx, ty, 3).stroke({ width: 1.2, color: g.def.color, alpha: 0.3 });
    }
  }

  private hudState(): HudState {
    const pg = this.playerDaemon;
    const banished = !!pg && (pg.state === 'eaten' || pg.state === 'quarantine');
    // A timed announcement (lives left, game over) outranks the banished banner.
    const banner = banished && this.msgTimer <= 0 && !this.gameOverPending;

    return {
      score: this.score,
      high: this.high,
      level: this.level,
      lives: this.lives,
      virusLives: this.virusLives,
      stance: this.stance,
      abilityName: banished ? 'DELETED' : pg ? pg.def.abilityName : '',
      abilityLocked: !!pg && pg.state !== 'normal',
      abilityReady: pg ? pg.cooldown <= 0 && pg.state === 'normal' : false,
      abilityCd: pg ? pg.cooldown : 0,
      abilityMax: pg ? pg.def.cooldown : 1,
      playerColor: pg ? pg.def.color : PALETTE.accent,
      playerDark: pg ? pg.def.colorDark : PALETTE.accent,
      playerId: this.playerId,
      playerName: pg ? pg.def.name : '',
      playerAbility: pg ? pg.def.abilityName : '',
      playerAbilityDesc: pg ? pg.def.abilityDesc : '',
      frightTimer: this.frightTimer,
      frightMax: FRIGHT_TIME,
      message:
        this.phase === 'paused'
          ? 'PAUSED'
          : banner
            ? 'DELETED!'
            : this.message,
      submessage:
        this.phase === 'paused'
          ? PAUSE_ITEMS.length
            ? ''
            : `PRESS ${this.device === 'gamepad' ? 'MENU' : 'P'} TO RESUME`
          : banner
            ? pg && pg.state === 'eaten'
              ? 'RETURNING TO THE QUARANTINE'
              : 'RESPAWNING…'
            : this.submessage,
      messageColor:
        this.phase === 'paused'
          ? PALETTE.text
          : banner
            ? PALETTE.danger
            : this.messageColor,
      pauseItems: this.phase === 'paused' ? PAUSE_ITEMS : [],
      pauseSelect: this.pauseSelect,
      device: this.device,
      muted: this.muted,
      trackName: this.audioHintText(),
      showFps: this.showFps,
      fps: this.lastFps,
    };
  }

  /** Menu/HUD line describing the audio state, so silence is never a mystery. */
  private audioHintText(): string {
    if (!this.music.available) return '';
    if (this.muted) return `SOUND MUTED  ·  ${this.device === 'gamepad' ? 'VIEW' : 'N'} TO UNMUTE`;
    if (!this.music.unlockedFlag) {
      return this.music.buffered ? 'PRESS ANY KEY FOR SOUND' : 'LOADING AUDIO…';
    }
    return this.music.trackName ? `♪ ${this.music.trackName}` : '';
  }

  /** Re-run every width-dependent layout after a viewport change. */
  layout(): void {
    this.buildBackdrop();
    this.layoutDemoMask();
    this.hud.layout();
    this.menu.layout();
    this.fx.resize(SCREEN_W, SCREEN_H);
    this.crt?.resize(this.app.renderer.width, this.app.renderer.height);
    this.clearStaleFilterTextures();
  }

  /**
   * Workaround for a Pixi 8.21 bug. FilterSystem.push() picks a nested
   * filter's resolution from its stack slot's input texture *from the previous
   * frame*. A resize prunes idle screen-sized textures from the pool, leaving
   * that slot pointing at a destroyed texture; the null source then throws
   * inside the ticker, and Pixi's ticker stops scheduling frames for good (the
   * game freezes). Clearing the slots makes it fall back to the root
   * resolution for the one frame before they are refilled.
   */
  private clearStaleFilterTextures(): void {
    const fs = this.app.renderer.filter as unknown as { _filterStack?: Array<{ inputTexture: unknown }> };
    for (const slot of fs._filterStack ?? []) slot.inputTexture = null;
  }

  /** Called on window resize; keeps the CRT in step with the render target. */
  onResize(): void {
    this.layout();
  }

  destroy(): void {
    this.audio.stopMusic();
    this.app.stage.removeChildren();
  }
}
