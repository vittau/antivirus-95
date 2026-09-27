import { COLS, POWER_RESPAWN, ROWS } from './config';
import { LEVELS } from './levels';
import type { LevelDef } from './levels';
import type { TilePos } from './types';

export const WALL = 0;
export const FLOOR = 1;
export const DOOR = 2;

export const idx = (c: number, r: number): number => r * COLS + c;

const STEPS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const;

// Scratch buffers shared by the flood fills (none of them re-enters another).
const bfsQueue = new Int32Array(COLS * ROWS);
const heapKeys: number[] = [];
const heapTiles: number[] = [];

/**
 * Static maze geometry plus the mutable pellet layer.
 *
 * Tiles are stored in flat typed arrays, refilled in place by `load` when a
 * level brings a new maze. `pruneUnreachable` floods from the virus's start
 * (with tunnel wrapping and the daemon door open) and turns anything
 * unreachable into a wall, so stray floor outside the playfield disappears.
 */
export class Maze {
  readonly kind: Uint8Array;
  private baseDots: Uint8Array;
  dots: Uint8Array;
  dotsLeft = 0;
  dotsTotal = 0;
  powerLeft = 0;
  powerTotal = 0;
  /** Floor reachable without the daemon door: everywhere but the quarantine. */
  private outside: Uint8Array;
  /** Side-portal corridor tiles, where daemons slow down and the virus doesn't. */
  private readonly tunnel: Uint8Array;
  /** Eaten power pellets and the seconds until each comes back. */
  respawns: Array<{ x: number; y: number; t: number }> = [];
  /** Rows with a wrap-around tunnel. */
  tunnelRows: number[] = [];
  level!: LevelDef;
  virusStart: TilePos = { x: 0, y: 0 };
  /** Bumped whenever the geometry changes (a new maze): cached fields go stale. */
  geometryVersion = 0;
  /** Bumped whenever a pellet is eaten or put back: pellet fields go stale. */
  dotsVersion = 0;
  private powerCache: TilePos[] = [];
  private powerCacheVersion = -1;
  private readonly openCache = new Map<number, TilePos>();

  constructor(level: LevelDef = LEVELS[0]) {
    const n = COLS * ROWS;
    this.kind = new Uint8Array(n);
    this.dots = new Uint8Array(n);
    this.baseDots = new Uint8Array(n);
    this.outside = new Uint8Array(n);
    this.tunnel = new Uint8Array(n);
    this.load(level);
  }

  /** Swap in a level's maze, pellets reset. */
  load(level: LevelDef): void {
    this.level = level;
    this.virusStart = level.virusStart;
    this.dots.fill(0);
    for (let r = 0; r < ROWS; r++) {
      const row = level.rows[r];
      for (let c = 0; c < COLS; c++) {
        const ch = row[c];
        const i = idx(c, r);
        if (ch === '#') this.kind[i] = WALL;
        else if (ch === '=') this.kind[i] = DOOR;
        else this.kind[i] = FLOOR;

        if (ch === '.') this.dots[i] = 1;
        else if (ch === 'o') this.dots[i] = 2;
      }
    }

    this.pruneUnreachable();
    const out = this.field([this.virusStart], false);
    this.outside = Uint8Array.from(out, (d) => (d >= 0 ? 1 : 0));
    this.findTunnels();
    this.baseDots = this.dots.slice();
    this.openCache.clear();
    this.geometryVersion++;
    this.recount();
  }

  /**
   * A row open at both edges wraps round. Its tunnel runs in from each edge
   * for as long as the corridor is walled above and below.
   */
  private findTunnels(): void {
    this.tunnel.fill(0);
    this.tunnelRows = [];
    const enclosed = (c: number, r: number): boolean =>
      this.kindAt(c, r) !== WALL && this.kindAt(c, r - 1) === WALL && this.kindAt(c, r + 1) === WALL;
    for (let r = 0; r < ROWS; r++) {
      if (this.kind[idx(0, r)] === WALL || this.kind[idx(COLS - 1, r)] === WALL) continue;
      this.tunnelRows.push(r);
      for (let c = 0; c < COLS && enclosed(c, r); c++) this.tunnel[idx(c, r)] = 1;
      for (let c = COLS - 1; c >= 0 && enclosed(c, r); c--) this.tunnel[idx(c, r)] = 1;
    }
  }

  isTunnel(c: number, r: number): boolean {
    if (r < 0 || r >= ROWS) return false;
    return this.tunnel[idx(this.wrapCol(c), r)] === 1;
  }

  private wrapCol(c: number): number {
    if (c < 0) return COLS - 1;
    if (c >= COLS) return 0;
    return c;
  }

  /** Flood from the virus's start; anything unreachable becomes wall. */
  private pruneUnreachable(): void {
    const seen = new Uint8Array(COLS * ROWS);
    const queue: number[] = [];
    const start = idx(this.virusStart.x, this.virusStart.y);
    seen[start] = 1;
    queue.push(start);

    while (queue.length) {
      const i = queue.pop() as number;
      const c = i % COLS;
      const r = (i / COLS) | 0;
      for (const [dc, dr] of STEPS) {
        const nr = r + dr;
        if (nr < 0 || nr >= ROWS) continue;
        const nc = this.wrapCol(c + dc);
        const ni = idx(nc, nr);
        // Door counts as reachable so the quarantine survives the pruning.
        if (seen[ni] || this.kind[ni] === WALL) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }

    for (let i = 0; i < this.kind.length; i++) {
      if (this.kind[i] !== WALL && !seen[i]) {
        this.kind[i] = WALL;
        this.dots[i] = 0;
      }
    }
  }

  /**
   * `dotsLeft` counts the ordinary pellets still to eat: clearing those clears
   * the maze. Power pellets are counted apart (`powerLeft`); an eaten one comes
   * back after POWER_RESPAWN, so they can't count toward clearing.
   */
  private recount(): void {
    let dots = 0;
    let power = 0;
    for (let i = 0; i < this.dots.length; i++) {
      if (this.dots[i] === 1) dots++;
      else if (this.dots[i] === 2) power++;
    }
    this.respawns = [];
    this.dotsVersion++;
    this.dotsLeft = dots;
    this.dotsTotal = dots;
    this.powerLeft = power;
    this.powerTotal = power;
  }

  resetDots(): void {
    this.dots.set(this.baseDots);
    this.recount();
  }

  kindAt(c: number, r: number): number {
    if (r < 0 || r >= ROWS) return WALL;
    const i = idx(this.wrapCol(c), r);
    return this.kind[i];
  }

  /** Flat array index for (c,r), wrapping columns. */
  index(c: number, r: number): number {
    return idx(this.wrapCol(c), Math.max(0, Math.min(ROWS - 1, r)));
  }

  isWall(c: number, r: number): boolean {
    return this.kindAt(c, r) === WALL;
  }

  /**
   * True where a daemon is clear of the vault: the ring of floor around it and
   * the rest of the maze. The chambers and their doors are not outside, so this
   * is what ends a daemon's 'leaving' walk.
   */
  isOutside(c: number, r: number): boolean {
    if (r < 0 || r >= ROWS) return false;
    return this.outside[this.index(c, r)] === 1;
  }

  walkable(c: number, r: number, daemonPass = false): boolean {
    const k = this.kindAt(c, r);
    if (k === WALL) return false;
    if (k === DOOR) return daemonPass;
    return true;
  }

  /**
   * The open floor tile nearest to `t` (which may lie inside a wall, inside
   * the quarantine or off the board). AI targets go through this so a path
   * always exists: BFS toward a target buried in a thick wall, or locked in
   * the quarantine, reaches nothing and the daemon wanders.
   */
  nearestOpen(t: TilePos): TilePos {
    const cx = Math.max(0, Math.min(COLS - 1, t.x));
    const cy = Math.max(0, Math.min(ROWS - 1, t.y));
    if (this.outside[idx(cx, cy)]) return { x: cx, y: cy };
    // The full scan below only depends on the target and the geometry, and
    // off-board targets (RELAY's, NULL's) recur frame after frame.
    const key = (t.x + 1024) * 2048 + (t.y + 1024);
    const hit = this.openCache.get(key);
    if (hit) return { x: hit.x, y: hit.y };
    let best: TilePos = { x: cx, y: cy };
    let bd = Infinity;
    for (let i = 0; i < this.kind.length; i++) {
      if (!this.outside[i]) continue;
      const x = i % COLS;
      const y = (i / COLS) | 0;
      const d = (x - t.x) * (x - t.x) + (y - t.y) * (y - t.y);
      if (d < bd) {
        bd = d;
        best = { x, y };
      }
    }
    if (this.openCache.size > 4096) this.openCache.clear();
    this.openCache.set(key, best);
    return { x: best.x, y: best.y };
  }

  /** 0 = nothing, 1 = dot, 2 = power pellet. */
  eat(c: number, r: number): number {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return 0;
    const i = idx(c, r);
    const v = this.dots[i];
    if (v === 1) this.dotsLeft--;
    else if (v === 2) {
      this.powerLeft--;
      this.respawns.push({ x: c, y: r, t: POWER_RESPAWN });
    }
    if (v !== 0) this.dotsVersion++;
    this.dots[i] = 0;
    return v;
  }

  /**
   * Count down the eaten power pellets and put back the ones that are due,
   * unless the virus is standing on the spot (it waits for it to leave).
   * Returns the tiles that came back.
   */
  tickRespawns(dt: number, virus: TilePos): TilePos[] {
    const back: TilePos[] = [];
    this.respawns = this.respawns.filter((p) => {
      p.t -= dt;
      if (p.t > 0 || (p.x === virus.x && p.y === virus.y)) return true;
      this.dots[idx(p.x, p.y)] = 2;
      this.powerLeft++;
      this.dotsVersion++;
      back.push({ x: p.x, y: p.y });
      return false;
    });
    return back;
  }

  /** All remaining power pellet tiles (shared until the pellets change: don't mutate). */
  powerTiles(): readonly TilePos[] {
    if (this.powerCacheVersion === this.dotsVersion) return this.powerCache;
    const out: TilePos[] = [];
    for (let i = 0; i < this.dots.length; i++) {
      if (this.dots[i] === 2) out.push({ x: i % COLS, y: (i / COLS) | 0 });
    }
    this.powerCache = out;
    this.powerCacheVersion = this.dotsVersion;
    return out;
  }

  allDotTiles(): TilePos[] {
    const out: TilePos[] = [];
    for (let i = 0; i < this.dots.length; i++) {
      if (this.dots[i] !== 0) out.push({ x: i % COLS, y: (i / COLS) | 0 });
    }
    return out;
  }

  /**
   * Multi-source BFS distance field (in tiles) over the maze.
   * Sources that land inside a wall are snapped to adjacent floor. Tiles in
   * `blocked` (by index) are treated as walls, sources included.
   */
  field(targets: readonly TilePos[], daemonPass = false, blocked?: ReadonlySet<number>): Int32Array {
    const n = COLS * ROWS;
    const dist = new Int32Array(n).fill(-1);
    const queue = bfsQueue;
    let head = 0;
    let tail = 0;

    const passable = (i: number): boolean => {
      if (blocked?.has(i)) return false;
      const k = this.kind[i];
      if (k === WALL) return false;
      if (k === DOOR) return daemonPass;
      return true;
    };

    const seed = (i: number): void => {
      if (dist[i] !== -1) return;
      dist[i] = 0;
      queue[tail++] = i;
    };

    for (const t of targets) {
      const c = Math.max(0, Math.min(COLS - 1, t.x));
      const r = Math.max(0, Math.min(ROWS - 1, t.y));
      const i = idx(c, r);
      if (passable(i)) {
        seed(i);
      } else {
        // Snap a blocked target to whichever neighbours are floor.
        for (const [dc, dr] of STEPS) {
          const nr = r + dr;
          if (nr < 0 || nr >= ROWS) continue;
          const ni = idx(this.wrapCol(c + dc), nr);
          if (passable(ni)) seed(ni);
        }
      }
    }

    while (head < tail) {
      const i = queue[head++];
      const c = i % COLS;
      const r = (i / COLS) | 0;
      const d = dist[i] + 1;
      for (const [dc, dr] of STEPS) {
        const nr = r + dr;
        if (nr < 0 || nr >= ROWS) continue;
        const ni = idx(this.wrapCol(c + dc), nr);
        if (dist[ni] !== -1 || !passable(ni)) continue;
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }

    return dist;
  }

  /**
   * Arrival-time field (seconds) for one actor moving at `speed` tiles/s,
   * seeded with a start delay per tile. Entering a tunnel tile costs
   * 1/`tunnelFactor` as much, matching the daemon slowdown there. Dijkstra
   * rather than BFS for that reason; -1 marks unreachable tiles.
   */
  travelTime(
    seeds: Array<{ x: number; y: number; t: number }>,
    speed: number,
    tunnelFactor: number,
    daemonPass = false,
    out?: Float32Array,
  ): Float32Array {
    const time = (out ?? new Float32Array(COLS * ROWS)).fill(-1);
    const passable = (i: number): boolean => {
      const k = this.kind[i];
      return k === FLOOR || (k === DOOR && daemonPass);
    };

    // Binary min-heap of (key, tile) with lazy deletion.
    const hk = heapKeys;
    const hv = heapTiles;
    hk.length = 0;
    hv.length = 0;
    const push = (k: number, v: number): void => {
      let i = hk.length;
      hk.push(k);
      hv.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hk[p] <= k) break;
        hk[i] = hk[p];
        hv[i] = hv[p];
        i = p;
      }
      hk[i] = k;
      hv[i] = v;
    };
    const pop = (): void => {
      const k = hk.pop() as number;
      const v = hv.pop() as number;
      const len = hk.length;
      if (len === 0) return;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= k) break;
        hk[i] = hk[c];
        hv[i] = hv[c];
        i = c;
      }
      hk[i] = k;
      hv[i] = v;
    };

    for (const s of seeds) {
      if (s.y < 0 || s.y >= ROWS) continue;
      const i = idx(this.wrapCol(s.x), s.y);
      if (!passable(i) || (time[i] >= 0 && time[i] <= s.t)) continue;
      time[i] = s.t;
      push(time[i], i);
    }

    const step = 1 / speed;
    const tunnelStep = step / tunnelFactor;
    while (hk.length) {
      const k = hk[0];
      const i = hv[0];
      pop();
      if (k > time[i]) continue; // stale entry
      const c = i % COLS;
      const r = (i / COLS) | 0;
      for (const [dc, dr] of STEPS) {
        const nr = r + dr;
        if (nr < 0 || nr >= ROWS) continue;
        const nc = this.wrapCol(c + dc);
        const ni = idx(nc, nr);
        if (!passable(ni)) continue;
        // Keys are rounded to float32 like the field, or the stale-entry check
        // above would drop live entries.
        const nt = Math.fround(k + (this.isTunnel(nc, nr) ? tunnelStep : step));
        if (time[ni] >= 0 && time[ni] <= nt) continue;
        time[ni] = nt;
        push(nt, ni);
      }
    }
    return time;
  }
}

/**
 * Memoised BFS fields so daemons can share paths. A field depends only on the
 * maze geometry and its target (plus the walled-off tiles for `around`), so
 * entries live across frames until the maze changes. Fields are shared: never
 * write into one.
 */
export class NavCache {
  private cache = new Map<number, Int32Array>();
  private aroundCache = new Map<string, Int32Array>();
  private version = -1;

  constructor(private readonly maze: Maze) {}

  clear(): void {
    this.cache.clear();
    this.aroundCache.clear();
  }

  /** Drop everything when the maze has changed since the last lookup. */
  private sync(): void {
    if (this.version === this.maze.geometryVersion) return;
    this.version = this.maze.geometryVersion;
    this.clear();
  }

  to(target: TilePos, daemonPass: boolean): Int32Array {
    this.sync();
    const key = ((target.x + 1024) * 2048 + (target.y + 1024)) * 2 + (daemonPass ? 1 : 0);
    let f = this.cache.get(key);
    if (!f) {
      f = this.maze.field([target], daemonPass);
      if (this.cache.size > 2048) this.cache.clear();
      this.cache.set(key, f);
    }
    return f;
  }

  /** Like `to`, but with the `blocked` tiles walled off. */
  around(target: TilePos, blocked: ReadonlySet<number>): Int32Array {
    this.sync();
    let key = `${target.x},${target.y}`;
    for (const i of blocked) key += `,${i}`;
    let f = this.aroundCache.get(key);
    if (!f) {
      f = this.maze.field([target], false, blocked);
      if (this.aroundCache.size > 256) this.aroundCache.clear();
      this.aroundCache.set(key, f);
    }
    return f;
  }
}
