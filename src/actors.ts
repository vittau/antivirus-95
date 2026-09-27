import {
  COLS,
  FRIGHT_SLOW,
  FRIGHT_TIME,
  DAEMONS,
  PLAYER_START,
  QUARANTINE_CHAMBERS,
  QUARANTINE_SLOTS,
  PHASE_TIME,
  PHASE_WARN,
  VIRUS_START_DIR,
  PALETTE,
  RESPAWN_BANISH,
  ROWS,
  SCATTER,
  SPEED,
  STANCE_INFO,
  TUNNEL_SLOW,
} from './config';
import { Maze, NavCache } from './maze';
import { Mover } from './mover';
import { DIRS, DIR_ORDER, OPPOSITE, addTile } from './types';
import type { Dir, DaemonState, DaemonId, Stance, TilePos, UnitDir } from './types';
import type { DaemonDef, QuarantineSlot } from './config';

export const neighborOf = (tx: number, ty: number, d: UnitDir): TilePos => ({
  x: (tx + DIRS[d].x + COLS) % COLS,
  y: ty + DIRS[d].y,
});

export const fieldAt = (maze: Maze, field: Int32Array, x: number, y: number): number =>
  field[maze.index(x, y)];

/** Danger/proximity fields recomputed once per frame and shared by the AI. */
export interface SimFields {
  /** Distance to the nearest remaining pellet (null when the maze is cleared). */
  dot: Int32Array | null;
  /** Seconds until the quickest dangerous daemon could reach each tile (-1: never). */
  threat: Float32Array;
  /** Distance to the nearest remaining power pellet (null when none are left). */
  power: Int32Array | null;
}

export interface SimContext {
  maze: Maze;
  nav: NavCache;
  virus: Virus;
  daemons: Daemon[];
  fields: SimFields;
  stance: Stance;
  playerId: DaemonId;
  level: number;
  /** The squad's stance targets, worked out once per frame (see squadPlan). */
  plan?: Map<DaemonId, Spot>;
  /** GUARD: the power pellet nobody guards (see Game.pickOpenPellet). */
  openPellet?: TilePos | null;
  /** FLANK: the virus's tiles, which flankers route around (see flankPlan). */
  virusBlock?: ReadonlySet<number>;
}

/** A squad target. `around`: get there without passing through the virus. */
export interface Spot extends TilePos {
  around?: boolean;
}

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

const DASH_BOOST = 1.75;

// ---------------------------------------------------------------------------
// Squad orders. AMBUSH, FLANK and GUARD are team plays: each AI daemon gets its
// own spot, so they spread out instead of queueing for the same tile.
// ---------------------------------------------------------------------------

/** How far ahead (tiles) AMBUSH reads the virus's route. */
const AMBUSH_LOOKAHEAD = 24;
/** the virus tiles that pass while an AI daemon covers one (they're slower). */
const DAEMON_PACE = SPEED.virus / SPEED.daemon;
/** Within this many tiles of the virus an ambusher stops cutting and charges. */
const AMBUSH_CHARGE = 6;

/**
 * Where the virus is headed: straight on while it can, and at a corner or T the
 * turn toward the nearer pellets (its usual pull when unthreatened).
 */
function predictRoute(ctx: SimContext): TilePos[] {
  const { maze, fields } = ctx;
  const m = ctx.virus.mover;
  let dir: UnitDir = m.dir !== 'none' ? m.dir : m.want !== 'none' ? m.want : 'left';
  let cur = m.nextTile;
  const route = [cur];
  const seen = new Set([maze.index(cur.x, cur.y)]);
  for (let i = 0; i < AMBUSH_LOOKAHEAD; i++) {
    let next: UnitDir | null = m.canEnterFrom(cur.x, cur.y, dir) ? dir : null;
    if (!next) {
      const side: UnitDir[] = dir === 'left' || dir === 'right' ? ['up', 'down'] : ['left', 'right'];
      let best = Infinity;
      for (const d of side) {
        if (!m.canEnterFrom(cur.x, cur.y, d)) continue;
        const n = neighborOf(cur.x, cur.y, d);
        const v = fields.dot ? fieldAt(maze, fields.dot, n.x, n.y) : 0;
        const score = v < 0 ? 999 : v;
        if (score < best) {
          best = score;
          next = d;
        }
      }
    }
    if (!next) break;
    cur = neighborOf(cur.x, cur.y, next);
    dir = next;
    const k = maze.index(cur.x, cur.y);
    if (seen.has(k)) break;
    seen.add(k);
    route.push(cur);
  }
  return route;
}

/** One way out of where the virus is. */
interface Branch {
  /** The tile next to it on this side. */
  start: TilePos;
  /** Tiles from each tile to it along this branch (-1: not via this one). */
  field: Int32Array;
}

/**
 * The sides the virus can be reached from: every open direction out of its
 * tile (and the one it's stepping into). `field` says which side of it a
 * tile is on: the branch it reaches it through soonest.
 */
function virusBranches(ctx: SimContext, block: ReadonlySet<number>): Branch[] {
  const { maze, nav } = ctx;
  const m = ctx.virus.mover;
  const own = m.t > 0 ? [m.tile, m.nextTile] : [m.tile];
  const out: Branch[] = [];
  for (const p of own) {
    for (const d of DIR_ORDER) {
      if (!m.canEnterFrom(p.x, p.y, d)) continue;
      const start = neighborOf(p.x, p.y, d);
      if (block.has(maze.index(start.x, start.y))) continue;
      out.push({ start, field: nav.around(start, block) });
    }
  }
  return out;
}

/**
 * FLANK: close in on it from every side at once. Each dangerous daemon
 * already covers the side it's coming from (the player's included); AI
 * daemons take the sides nobody covers, routing round it to come in through
 * that side. Spare daemons double up on the side they reach soonest. Returns
 * the daemons left without a side.
 */
function flankPlan(ctx: SimContext, squad: Daemon[], plan: Map<DaemonId, Spot>): Daemon[] {
  const { maze } = ctx;
  const m = ctx.virus.mover;
  const block = new Set((m.t > 0 ? [m.tile, m.nextTile] : [m.tile]).map((p) => maze.index(p.x, p.y)));
  ctx.virusBlock = block;
  const branches = virusBranches(ctx, block);
  if (!branches.length) return squad;

  const sideOf = (g: Daemon): number => {
    const i = maze.index(g.mover.tx, g.mover.ty);
    let best = -1;
    let bestD = Infinity;
    branches.forEach((b, k) => {
      const v = b.field[i];
      if (v >= 0 && v < bestD) {
        bestD = v;
        best = k;
      }
    });
    return best;
  };

  const covered = new Set<number>();
  for (const g of ctx.daemons) {
    if (g.isPlayer && g.state === 'normal') covered.add(sideOf(g));
  }
  const side = new Map(squad.map((g) => [g.id, sideOf(g)]));
  // Tiles from each daemon to each side's way in, going round it.
  const cost = new Map(
    squad.map((g) => {
      const around = ctx.nav.around(g.mover.tile, block);
      return [g.id, branches.map((b) => around[maze.index(b.start.x, b.start.y)])] as const;
    }),
  );

  let left = squad;
  for (let round = 0; left.length && round < 2; round++) {
    const open = branches.map((_, k) => k).filter((k) => round > 0 || !covered.has(k));
    while (left.length && open.length) {
      let pick: { g: Daemon; k: number; c: number } | null = null;
      for (const g of left) {
        for (const k of open) {
          const v = (cost.get(g.id) as number[])[k];
          if (v >= 0 && (!pick || v < pick.c)) pick = { g, k, c: v };
        }
      }
      if (!pick) break;
      const { g, k } = pick;
      // Already on that side: straight at it. Otherwise round to it.
      plan.set(g.id, side.get(g.id) === k ? m.tile : { ...branches[k].start, around: true });
      open.splice(open.indexOf(k), 1);
      left = left.filter((x) => x !== g);
    }
  }
  return left;
}

/** Hand out distinct spots, cheapest daemon-spot pair first. */
function assignSpots(
  squad: Daemon[],
  spots: TilePos[],
  cost: (g: Daemon, p: TilePos) => number,
  plan: Map<DaemonId, Spot>,
): Daemon[] {
  const free = new Set(spots.map((_, i) => i));
  let left = [...squad];
  while (left.length && free.size) {
    let pick: { g: Daemon; i: number; c: number } | null = null;
    for (const g of left) {
      for (const i of free) {
        const c = cost(g, spots[i]);
        if (c < Infinity && (!pick || c < pick.c)) pick = { g, i, c };
      }
    }
    if (!pick) break;
    plan.set(pick.g.id, spots[pick.i]);
    free.delete(pick.i);
    left = left.filter((g) => g !== pick.g);
  }
  return left;
}

/**
 * Targets for this frame's stance. Daemons left without a spot pursue it
 * directly, except under GUARD, where they're left out and hunt as in HUNT.
 */
function squadPlan(ctx: SimContext): Map<DaemonId, Spot> {
  if (ctx.plan) return ctx.plan;
  const plan = new Map<DaemonId, Spot>();
  ctx.plan = plan;
  const { maze } = ctx;
  const squad = ctx.daemons.filter((g) => !g.isPlayer && g.state === 'normal');
  if (!squad.length) return plan;
  const reachField = new Map(squad.map((g) => [g.id, ctx.nav.to(g.mover.tile, false)]));
  const reach = (g: Daemon, p: TilePos): number => {
    const v = (reachField.get(g.id) as Int32Array)[maze.index(p.x, p.y)];
    return v < 0 ? Infinity : v;
  };

  let rest: Daemon[] = squad;
  const stance = ctx.stance === 'guard' && maze.powerLeft === 0 ? 'ambush' : ctx.stance;
  if (stance === 'ambush') {
    // A daemon already close charges it. The others each take the earliest
    // point on its route they can reach before it does, at least two tiles
    // from anyone else's; failing that, the far end.
    const route = predictRoute(ctx);
    const lead = ctx.virus.mover.t > 0 ? 1 - ctx.virus.mover.t : 0;
    const taken: number[] = [];
    const order = [...squad].sort(
      (a, b) => Math.min(...route.map((p) => reach(a, p))) - Math.min(...route.map((p) => reach(b, p))),
    );
    rest = [];
    for (const g of order) {
      if (reach(g, ctx.virus.mover.tile) <= AMBUSH_CHARGE) {
        rest.push(g);
        continue;
      }
      let chosen = -1;
      for (let i = 0; i < route.length; i++) {
        if (taken.some((j) => Math.abs(j - i) < 2)) continue;
        if (reach(g, route[i]) * DAEMON_PACE <= lead + i) {
          chosen = i;
          break;
        }
      }
      if (chosen < 0) {
        for (let i = route.length - 1; i >= 0; i--) {
          if (!taken.some((j) => Math.abs(j - i) < 2)) {
            chosen = i;
            break;
          }
        }
      }
      if (chosen < 0) rest.push(g);
      else {
        taken.push(chosen);
        plan.set(g.id, route[chosen]);
      }
    }
  } else if (stance === 'flank') {
    rest = flankPlan(ctx, squad, plan);
  } else if (stance === 'guard') {
    // One daemon per remaining power pellet bar the open one, nearest first.
    const open = ctx.openPellet;
    const guarded = maze.powerTiles().filter((p) => !open || p.x !== open.x || p.y !== open.y);
    assignSpots(squad, guarded, reach, plan);
    return plan;
  }
  for (const g of rest) plan.set(g.id, ctx.virus.mover.tile);
  return plan;
}

/** AI daemons speed up a little each level. */
const levelSpeedUp = (level: number): number => Math.min(1.35, 1 + (level - 1) * 0.045);

/**
 * Seconds until any dangerous daemon could reach each tile. Each daemon gets its
 * own travel-time field at its current top speed (dash included), so the virus
 * reads a dashing VOLT as the threat it is; the tunnel slowdown is priced in,
 * which is what makes the side portals a real escape route.
 */
/** Scratch for one daemon's travel-time field, merged straight into the result. */
const travelScratch = new Float32Array(COLS * ROWS);

export function threatField(maze: Maze, daemons: Daemon[], level: number): Float32Array {
  const out = new Float32Array(COLS * ROWS).fill(-1);
  for (const g of daemons) {
    // A frightened daemon about to recover is already a threat, just a later one.
    const recovering = g.state === 'frightened' && g.frightTimer < 1.2;
    if (!g.isDangerous() && !recovering) continue;
    const delay = recovering ? g.frightTimer : 0;
    const speed = g.cruiseSpeed(level);
    const m = g.mover;
    // Mid-tile, the daemon could end up on either end of its step (the player
    // can reverse at will), so seed both.
    const seeds = [{ x: m.tx, y: m.ty, t: delay + m.t / speed }];
    if (m.t > 0 && m.dir !== 'none') {
      const n = m.nextTile;
      seeds.push({ x: n.x, y: n.y, t: delay + (1 - m.t) / speed });
    }
    const f = maze.travelTime(seeds, speed, TUNNEL_SLOW, g.state === 'leaving', travelScratch);
    for (let i = 0; i < out.length; i++) {
      if (f[i] >= 0 && (out[i] < 0 || f[i] < out[i])) out[i] = f[i];
    }
  }
  return out;
}

// the virus AI tuning.
/** A daemon this many seconds from the virus's next tile puts it in escape mode. */
const THREAT_HORIZON = 1.1;
/** the virus must beat a daemon to a tile by this much for it to count as safe. */
const SAFE_MARGIN = 0.12;
/** Escape-room tiles worth counting; beyond this a route is simply "open". */
const ROOM_CAP = 40;
/** Prey this close (in tiles) gets its full, locked-on attention. */
const FURY_RANGE = 5;
/** Minimum time between two reversals, so it commits instead of dithering. */
const REVERSE_COOLDOWN = 0.45;

/** One way the virus could go from where it is now. */
interface Route {
  dir: UnitDir;
  /** First tile on the route. */
  tile: TilePos;
  /** Tiles the virus covers to reach it. */
  lead: number;
  /** The tile it'd be putting behind it (the escape search can't re-enter it). */
  behind: TilePos;
  reverse: boolean;
}

/** What lies down a route: how much of the maze it can still reach first. */
interface Room {
  tiles: number;
  power: boolean;
  tunnel: boolean;
}

// ---------------------------------------------------------------------------
// the virus — the AI hero. Clears pellets, flees daemons, and hunts when powered.
// ---------------------------------------------------------------------------
export class Virus {
  readonly mover: Mover;
  mouth = 0.2;
  private mouthPhase = 0;
  powered = false;
  alive = true;
  deathT = 0;
  dir: Dir = 'left';
  /** HALT's FREEZE: seconds left disoriented, picking turns at random. */
  blind = 0;
  /** While blind: the tile it last picked a turn for, and the turn. */
  private blindAt = -1;
  private blindDir: UnitDir = 'left';
  /** The frightened daemon it has locked onto at close range, if any. */
  private prey: Daemon | null = null;
  private reverseCd = 0;

  constructor(maze: Maze) {
    this.mover = new Mover(maze);
  }

  spawn(): void {
    const start = this.mover.maze.virusStart;
    this.mover.place(start.x, start.y, VIRUS_START_DIR);
    this.mover.speed = SPEED.virus;
    this.powered = false;
    this.alive = true;
    this.deathT = 0;
    this.dir = VIRUS_START_DIR;
    this.blind = 0;
    this.prey = null;
    this.reverseCd = 0;
  }

  get px(): number {
    return this.mover.px;
  }

  get py(): number {
    return this.mover.py;
  }

  get tile(): TilePos {
    return this.mover.tile;
  }

  /** Closing in on a locked-on prey: faster, and it shows. */
  get furious(): boolean {
    return this.powered && this.prey !== null && this.blind <= 0;
  }

  private get speed(): number {
    if (this.furious) return SPEED.virusFury;
    return this.powered ? SPEED.virusPowered : SPEED.virus;
  }

  /**
   * Every way it can go. Turns are judged at the tile where they can actually
   * happen (the one it's heading into), and reversing is its own route — it's
   * the only way out when a daemon appears ahead.
   */
  private routes(): Route[] {
    const m = this.mover;
    const at = m.nextTile;
    const moving = m.dir !== 'none';
    const midTile = moving && m.t > 0;
    const lead = midTile ? 1 - m.t : 0;
    const back = OPPOSITE[m.dir];
    const out: Route[] = [];

    for (const d of DIR_ORDER) {
      if (d === back || !m.canEnterFrom(at.x, at.y, d)) continue;
      out.push({ dir: d, tile: neighborOf(at.x, at.y, d), lead: lead + 1, behind: at, reverse: false });
    }
    if (back !== 'none') {
      const b = back as UnitDir;
      if (midTile) {
        out.push({ dir: b, tile: m.tile, lead: m.t, behind: at, reverse: true });
      } else if (m.canEnterFrom(at.x, at.y, b)) {
        out.push({ dir: b, tile: neighborOf(at.x, at.y, b), lead: 1, behind: at, reverse: true });
      }
    }
    return out;
  }

  /** Can it reach tile index `i` (after `tiles` steps) before any daemon? */
  private safeAt(threat: Float32Array, i: number, tiles: number): boolean {
    const t = threat[i];
    return t < 0 || tiles / this.speed + SAFE_MARGIN < t;
  }

  /**
   * Flood outward from a route's first tile through every tile the virus reaches
   * before any daemon can. A big room means a real escape; a small one is a
   * trap closing. Power pellets and the tunnel in the room are noted.
   */
  private room(ctx: SimContext, r: Route): Room {
    const { maze } = ctx;
    const threat = ctx.fields.threat;
    const out: Room = { tiles: 0, power: false, tunnel: false };
    const start = maze.index(r.tile.x, r.tile.y);
    if (!this.safeAt(threat, start, r.lead)) return out;

    const seen = new Set<number>([maze.index(r.behind.x, r.behind.y), start]);
    const queue: Array<[number, number]> = [[start, r.lead]];
    for (let head = 0; head < queue.length && out.tiles < ROOM_CAP; head++) {
      const [i, d] = queue[head];
      out.tiles++;
      const c = i % COLS;
      const row = (i / COLS) | 0;
      if (maze.dots[i] === 2) out.power = true;
      if (maze.isTunnel(c, row)) out.tunnel = true;
      for (const dir of DIR_ORDER) {
        const n = neighborOf(c, row, dir);
        if (!maze.walkable(n.x, n.y)) continue;
        const ni = maze.index(n.x, n.y);
        if (seen.has(ni)) continue;
        seen.add(ni);
        if (this.safeAt(threat, ni, d + 1)) queue.push([ni, d + 1]);
      }
    }
    return out;
  }

  /**
   * Powered up: the tiles of the frightened daemons worth chasing. Once one is
   * within FURY_RANGE it locks onto it and won't be distracted until it's
   * eaten or recovers. Otherwise, the ones it can catch before the power runs
   * out, and your daemon when it's anywhere near as close as the rest — eating
   * the player is what hurts.
   */
  private huntGoals(ctx: SimContext): Set<number> | null {
    const { maze } = ctx;
    const from = ctx.nav.to(this.mover.nextTile, false);
    const distTo = (g: Daemon): number => fieldAt(maze, from, g.mover.tx, g.mover.ty);
    // The tile nearest to where the daemon actually is. Aiming at where it's
    // heading breaks head-on (that's the tile the virus is leaving, so it'd turn
    // away); aiming at where it came from lags a fleeing daemon.
    const goal = (g: Daemon): Set<number> => {
      const t = g.mover.t >= 0.5 ? g.mover.nextTile : g.mover.tile;
      return new Set([maze.index(t.x, t.y)]);
    };

    const prey = this.prey;
    if (prey && prey.state === 'frightened') {
      const d = distTo(prey);
      if (d >= 0 && d <= FURY_RANGE + 3) return goal(prey);
    }
    this.prey = null;

    const catchable: Array<{ g: Daemon; d: number }> = [];
    for (const g of ctx.daemons) {
      if (g.state !== 'frightened') continue;
      const d = distTo(g);
      // Frightened daemons wander, so it closes at most of its speed.
      if (d >= 0 && d / (SPEED.virusPowered * 0.7) < g.frightTimer) catchable.push({ g, d });
    }
    if (!catchable.length) return null;
    const nearest = catchable.reduce((a, b) => (b.d < a.d ? b : a));
    const player = catchable.find((c) => c.g.isPlayer);
    const pick = player && player.d <= nearest.d + 6 ? [player] : catchable;
    const closest = pick.reduce((a, b) => (b.d < a.d ? b : a));
    if (closest.d <= FURY_RANGE) {
      this.prey = closest.g;
      return goal(closest.g);
    }
    const out = new Set<number>();
    for (const c of pick) for (const i of goal(c.g)) out.add(i);
    return out;
  }

  /**
   * Tiles to the nearest goal along a route, never doubling back through the
   * tile the route leaves behind. (A shared distance field would let a
   * reversal "reach" prey through the very tile it's turning away from.)
   */
  private routeLength(ctx: SimContext, goals: Set<number>, r: Route): number {
    const { maze } = ctx;
    const start = maze.index(r.tile.x, r.tile.y);
    if (goals.has(start)) return r.lead;
    const seen = new Set<number>([maze.index(r.behind.x, r.behind.y), start]);
    let frontier = [start];
    for (let steps = 1; frontier.length && steps < 60; steps++) {
      const next: number[] = [];
      for (const i of frontier) {
        const c = i % COLS;
        const row = (i / COLS) | 0;
        for (const dir of DIR_ORDER) {
          const n = neighborOf(c, row, dir);
          if (!maze.walkable(n.x, n.y)) continue;
          const ni = maze.index(n.x, n.y);
          if (seen.has(ni)) continue;
          if (goals.has(ni)) return r.lead + steps;
          seen.add(ni);
          next.push(ni);
        }
      }
      frontier = next;
    }
    return Infinity;
  }

  decide(ctx: SimContext): void {
    const m = this.mover;
    const routes = this.routes();
    if (routes.length === 0) return;
    const { fields, maze } = ctx;
    const at = m.nextTile;

    // --- Blind: it's lost track of everything. At each junction it takes a
    // turn at random (never doubling back unless it's a dead end) and sticks
    // with it until the next one.
    if (this.blind > 0) {
      const forward = routes.filter((r) => !r.reverse);
      const pool = forward.length ? forward : routes;
      const key = maze.index(at.x, at.y);
      if (this.blindAt !== key || !pool.some((r) => r.dir === this.blindDir)) {
        this.blindAt = key;
        this.blindDir = pool[(Math.random() * pool.length) | 0].dir;
      }
      m.want = this.blindDir;
      return;
    }
    this.blindAt = -1;

    const pathTo = (field: Int32Array | null, r: Route, missing: number): number => {
      if (!field) return 0;
      const v = fieldAt(maze, field, r.tile.x, r.tile.y);
      return v < 0 ? missing : r.lead + v;
    };

    const scored: Array<{ r: Route; score: number }> = [];
    const threat = ctx.fields.threat;
    const hunt = this.powered ? this.huntGoals(ctx) : null;
    if (!hunt) this.prey = null;

    if (hunt) {
      // --- Hunt: chase the catchable daemon, turning round for it if needed,
      // but never through a daemon that has recovered. Prey at the tile just
      // ahead is within reach once it gets there: keep charging.
      if (hunt.has(maze.index(at.x, at.y)) && m.dir !== 'none') {
        m.want = m.dir;
        return;
      }
      for (const r of routes) {
        const safe = this.safeAt(threat, maze.index(r.tile.x, r.tile.y), r.lead);
        const len = Math.min(99, this.routeLength(ctx, hunt, r));
        scored.push({ r, score: -len * 4 - (safe ? 0 : 200) });
      }
    } else {
      const near = threat[maze.index(at.x, at.y)];
      const threatened = near >= 0 && near < THREAT_HORIZON;
      const canPressOn = routes.some((r) => !r.reverse);

      for (const r of routes) {
        const i = maze.index(r.tile.x, r.tile.y);
        const dotD = pathTo(fields.dot, r, 60);
        const t = threat[i];
        // How far ahead of the daemons this tile keeps it, in its own tiles.
        const gap = t < 0 ? 12 : Math.max(-6, Math.min(12, t * this.speed - r.lead));

        if (!threatened) {
          // Nobody close: clear pellets decisively; stay only mildly wary.
          if (r.reverse && canPressOn) continue;
          scored.push({ r, score: -dotD + Math.min(gap, 6) * 0.35 });
          continue;
        }

        // --- Escape: prefer the route with the most maze it can still reach
        // first. A power pellet in that room is a counter-attack; the tunnel
        // slows the daemons, not it.
        const room = this.room(ctx, r);
        let score = room.tiles * 3 + gap - dotD * 0.6;
        if (room.power && !this.powered && fields.power) score += 30 - pathTo(fields.power, r, 30) * 1.5;
        if (room.tunnel) score += 12;
        scored.push({ r, score });
      }
    }

    let best: { r: Route; score: number } | null = null;
    let bestForward: { r: Route; score: number } | null = null;
    for (const s of scored) {
      s.score += Math.random() * 0.02;
      if (!best || s.score > best.score) best = s;
      if (!s.r.reverse && (!bestForward || s.score > bestForward.score)) bestForward = s;
    }
    if (!best) return;

    // Reversing mid-corridor has to clearly beat pressing on, and not too often.
    if (best.r.reverse && bestForward) {
      const margin = hunt ? 2 : 6;
      if (this.reverseCd > 0 || best.score < bestForward.score + margin) best = bestForward;
    }
    if (best.r.reverse) this.reverseCd = REVERSE_COOLDOWN;
    m.want = best.r.dir;
  }

  update(dt: number, ctx: SimContext): void {
    if (!this.alive) {
      this.deathT += dt;
      return;
    }
    if (this.reverseCd > 0) this.reverseCd = Math.max(0, this.reverseCd - dt);
    if (this.blind > 0) this.blind = Math.max(0, this.blind - dt);
    this.decide(ctx);
    this.mover.speed = this.speed;
    this.mover.update(dt);
    this.dir = this.mover.dir;

    const moving = this.mover.dir !== 'none';
    this.mouthPhase += dt * (moving ? (this.furious ? 24 : 14) : 4);
    const open = 0.5 - 0.5 * Math.cos(this.mouthPhase);
    this.mouth = 0.06 + open * 0.95;
  }
}

// ---------------------------------------------------------------------------
// Daemons — the squad. One is driven by the player, the rest by AI.
// ---------------------------------------------------------------------------
export class Daemon {
  readonly mover: Mover;
  readonly def: DaemonDef;
  readonly slot: QuarantineSlot;
  state: DaemonState = 'quarantine';
  isPlayer = false;
  /**
   * The chamber this daemon leaves through, or -1 while it is outside (the
   * player at a round start, and the ring slot above the vault). Set from the
   * slot at spawn, then from whichever chamber a deleted daemon reboots in.
   */
  chamber = -1;
  /** The chamber an 'eaten' daemon picked to reboot in, chosen once (-1: none). */
  private eatenChamber = -1;
  /** Last tile this daemon chose to path toward (used for intent lines). */
  lastTarget: TilePos = { x: 0, y: 0 };

  bob = 0;
  private bobPhase = Math.random() * Math.PI * 2;
  private releaseTimer = 0;
  frightTimer = 0;
  flash = false;

  // Ability / status.
  dashTimer = 0;
  cooldown = 0;
  /** PHASE: true while the daemon may pass through walls. */
  phaseActive = false;
  private phaseInsideWall = false;
  /** PHASE: seconds since it was switched on. */
  private phaseTime = 0;
  /** Set when PHASE ran out inside a wall and pushed it out (the game clears it). */
  phaseEjected = false;

  constructor(maze: Maze, def: DaemonDef) {
    this.def = def;
    this.mover = new Mover(maze);
    this.slot = QUARANTINE_SLOTS[def.id];
  }

  get id(): DaemonId {
    return this.def.id;
  }

  get px(): number {
    return this.mover.px;
  }

  get py(): number {
    return this.mover.py + this.bob;
  }

  get tile(): TilePos {
    return this.mover.tile;
  }

  isDangerous(): boolean {
    return this.state === 'normal' || this.state === 'leaving';
  }

  isEdible(): boolean {
    return this.state === 'frightened';
  }

  spawn(level: number): void {
    const speedUp = levelSpeedUp(level);
    if (this.isPlayer) {
      this.mover.place(PLAYER_START.x, PLAYER_START.y, 'left');
      this.state = 'normal';
      this.chamber = -1;
    } else {
      this.mover.place(this.slot.x, this.slot.y, 'up');
      this.state = 'quarantine';
      this.chamber = this.slot.chamber;
      this.releaseTimer = 0;
    }
    this.eatenChamber = -1;
    this.mover.speed = SPEED.daemon * speedUp;
    this.mover.daemonPass = false;
    this.mover.phase = false;
    this.mover.want = 'none';
    this.frightTimer = 0;
    this.flash = false;
    this.dashTimer = 0;
    this.cooldown = 0;
    this.phaseActive = false;
    this.phaseInsideWall = false;
    this.phaseTime = 0;
    this.phaseEjected = false;
    this.bob = 0;
  }

  frighten(): void {
    if (this.state === 'leaving') {
      // Still in the quarantine: keep the way out through the door (a frightened
      // daemon may not use it) and turn blue on reaching the maze.
      this.frightTimer = FRIGHT_TIME;
    } else if (this.state === 'normal') {
      this.state = 'frightened';
      this.frightTimer = FRIGHT_TIME;
      this.flash = false;
      // The AI squad turns tail; the player's daemon keeps its heading, so
      // escaping is the player's call.
      if (!this.isPlayer && this.mover.dir !== 'none') this.mover.reverse();
    } else if (this.state === 'frightened') {
      this.frightTimer = FRIGHT_TIME;
    }
  }

  get isBanished(): boolean {
    return this.state === 'eaten';
  }

  /**
   * The virus deleted it: the eyes float home to the nearer chamber (chosen by
   * BFS, then cached until it reboots). Called by the game on a collision.
   */
  beginDeleted(): void {
    this.state = 'eaten';
    this.eatenChamber = -1;
    this.mover.daemonPass = true;
    this.mover.phase = false;
    this.frightTimer = 0;
  }

  /** The chamber whose home tile is nearest, by BFS distance (doors included). */
  private nearestChamber(ctx: SimContext): number {
    const m = this.mover;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < QUARANTINE_CHAMBERS.length; i++) {
      const f = ctx.nav.to(QUARANTINE_CHAMBERS[i].home, true);
      const d = fieldAt(m.maze, f, m.tx, m.ty);
      if (d >= 0 && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * PHASE: one traversal through a wall, within PHASE_TIME seconds. It
   * switches off the moment the daemon is back on a walkable tile. If time runs
   * out (it blinks from PHASE_WARN) while it's inside a wall, it pushes it
   * out, so it can never strand anyone inside geometry.
   */
  beginPhase(): void {
    this.phaseActive = true;
    this.phaseInsideWall = false;
    this.phaseTime = 0;
    this.mover.phase = true;
    // Travel straight through rather than turning inside the wall.
    if (this.mover.dir !== 'none') this.mover.want = this.mover.dir;
  }

  private updateTimers(dt: number): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.dashTimer > 0) this.dashTimer = Math.max(0, this.dashTimer - dt);

    if (this.phaseActive) {
      this.phaseTime += dt;
      const inWall = this.mover.maze.isWall(this.mover.tx, this.mover.ty);
      if (inWall) this.phaseInsideWall = true;
      else if (this.phaseInsideWall) this.phaseActive = false; // back on the track
      if (this.phaseActive && this.phaseTime >= PHASE_TIME) {
        if (inWall) this.ejectFromWall();
        else this.phaseActive = false;
      }
      this.mover.phase = this.phaseActive;
    } else if (this.mover.phase) {
      this.mover.phase = false;
    }
  }

  /** PHASE about to run out: it blinks, faster toward the end. */
  get phaseBlink(): boolean {
    if (!this.phaseActive || this.phaseTime < PHASE_WARN) return false;
    const late = this.phaseTime >= PHASE_WARN + (PHASE_TIME - PHASE_WARN) / 2;
    return Math.floor(this.phaseTime * (late ? 12 : 6)) % 2 === 0;
  }

  /** PHASE ran out inside a wall: out onto the nearest track, same heading. */
  private ejectFromWall(): void {
    const m = this.mover;
    const d = m.dir === 'none' ? { x: 0, y: 0 } : DIRS[m.dir];
    const dest = m.maze.nearestOpen({ x: Math.round(m.tx + d.x * m.t), y: Math.round(m.ty + d.y * m.t) });
    m.place(dest.x, dest.y, m.dir);
    this.phaseActive = false;
    this.phaseInsideWall = false;
    this.phaseEjected = true;
  }

  /** Open-corridor speed right now (dash included), for the virus's threat model. */
  cruiseSpeed(level: number): number {
    if (this.state === 'leaving') return SPEED.daemon * 0.8;
    return this.baseSpeed(level) * (this.dashTimer > 0 ? DASH_BOOST : 1);
  }

  private baseSpeed(level: number): number {
    return this.isPlayer ? SPEED.playerDaemon : SPEED.daemon * levelSpeedUp(level);
  }

  private speedFor(level: number): number {
    const m = this.mover;
    const tunnel = m.maze.isTunnel(m.tx, m.ty) ? TUNNEL_SLOW : 1;
    switch (this.state) {
      case 'quarantine':
        return 0;
      case 'leaving':
        return SPEED.daemon * 0.8;
      case 'eaten':
        return SPEED.daemonEaten;
      case 'frightened':
        return this.baseSpeed(level) * FRIGHT_SLOW * tunnel;
      default:
        return (this.isPlayer ? SPEED.playerDaemon : m.speed) * tunnel * (this.dashTimer > 0 ? DASH_BOOST : 1);
    }
  }

  private targetFor(ctx: SimContext): Spot {
    if (this.state === 'leaving') {
      // Out through this daemon's own chamber door onto the ring.
      return this.chamber >= 0 ? QUARANTINE_CHAMBERS[this.chamber].exit : this.mover.tile;
    }
    if (this.state === 'eaten') {
      if (this.eatenChamber < 0) this.eatenChamber = this.nearestChamber(ctx);
      return QUARANTINE_CHAMBERS[this.eatenChamber].home;
    }

    const virusTile = { x: ctx.virus.mover.tx, y: ctx.virus.mover.ty };
    const virusDir: UnitDir = ctx.virus.mover.dir === 'none' ? 'left' : (ctx.virus.mover.dir as UnitDir);

    const hunt = (): TilePos => ctx.maze.nearestOpen(this.personalityTarget(ctx, virusTile, virusDir));
    if (ctx.stance === 'hunt') return hunt();
    return squadPlan(ctx).get(this.id) ?? hunt();
  }

  private personalityTarget(ctx: SimContext, virusTile: TilePos, virusDir: UnitDir): TilePos {
    switch (this.id) {
      case 'relay':
        return addTile(virusTile, DIRS[virusDir], 4);
      case 'null': {
        const volt = ctx.daemons.find((g) => g.id === 'volt');
        const pivot = addTile(virusTile, DIRS[virusDir], 2);
        if (!volt) return pivot;
        return { x: pivot.x * 2 - volt.mover.tx, y: pivot.y * 2 - volt.mover.ty };
      }
      case 'halt': {
        const d = dist(this.mover.tx, this.mover.ty, virusTile.x, virusTile.y);
        return d >= 8 ? virusTile : SCATTER.halt;
      }
      default:
        return virusTile;
    }
  }

  /**
   * Choose a direction: BFS toward the target, random when frightened. Judged
   * at the tile where the turn can actually happen (the one the daemon is
   * heading into), like the virus; judging from the tile it's leaving made every
   * daemon overshoot junctions and zig-zag.
   */
  private chooseDir(ctx: SimContext, target: Spot): void {
    const m = this.mover;
    let at = m.nextTile;
    let back = OPPOSITE[m.dir];

    // Eyes heading home turn round when home is behind them, instead of
    // running to the end of the corridor and doubling back. Mid-step it turns
    // in place and then judges the turn at the tile it is returning to, so it
    // can take the branch home there instead of sailing past it (turning from
    // the tile being left made the eyes stall at a junction it could not enter).
    if (this.state === 'eaten' && back !== 'none') {
      const field = ctx.nav.to(target, true);
      const ahead = fieldAt(m.maze, field, at.x, at.y);
      const behindTile = m.t > 0 ? m.tile : neighborOf(at.x, at.y, back as UnitDir);
      const canTurn = m.t > 0 || m.canEnterFrom(at.x, at.y, back as UnitDir);
      const behind = canTurn ? fieldAt(m.maze, field, behindTile.x, behindTile.y) : -1;
      const aheadCost = (m.t > 0 ? 1 - m.t : 0) + ahead;
      const behindCost = (m.t > 0 ? m.t : 1) + behind;
      if (behind >= 0 && (ahead < 0 || behindCost + 0.5 < aheadCost)) {
        if (m.t > 0) {
          m.reverse();
          at = m.nextTile;
          back = OPPOSITE[m.dir];
        } else {
          m.want = back;
          return;
        }
      }
    }

    const opts: UnitDir[] = [];
    for (const d of DIR_ORDER) {
      if (d === back) continue;
      if (m.canEnterFrom(at.x, at.y, d)) opts.push(d);
    }
    if (opts.length === 0) {
      // Dead end ahead: turn round once there, not halfway along the step.
      if (m.t > 0) m.want = m.dir;
      else if (back !== 'none' && m.canEnterFrom(at.x, at.y, back as UnitDir)) m.want = back;
      return;
    }
    if (opts.length === 1) {
      m.want = opts[0];
      return;
    }
    if (this.state === 'frightened') {
      m.want = opts[(Math.random() * opts.length) | 0];
      return;
    }

    const field =
      target.around && ctx.virusBlock ? ctx.nav.around(target, ctx.virusBlock) : ctx.nav.to(target, m.daemonPass);
    let best = opts[0];
    let bestD = Infinity;
    for (const d of opts) {
      const n = neighborOf(at.x, at.y, d);
      const dd = fieldAt(m.maze, field, n.x, n.y);
      if (dd >= 0 && dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    m.want = best;
  }

  update(dt: number, ctx: SimContext): void {
    this.updateTimers(dt);

    if (this.state === 'quarantine') {
      this.bobPhase += dt * 3.2;
      this.bob = Math.sin(this.bobPhase) * 2.5;
      this.releaseTimer += dt;
      if (this.releaseTimer >= this.slot.release) {
        this.state = 'leaving';
        this.mover.daemonPass = true;
      }
      return;
    }

    this.bob = 0;
    this.mover.daemonPass = this.state === 'leaving' || this.state === 'eaten';

    if (this.state === 'frightened') {
      this.flash = this.frightTimer < FRIGHT_TIME * 0.32;
      if (this.frightTimer <= 0) {
        this.state = 'normal';
        this.flash = false;
      }
    }

    if (this.state === 'eaten') {
      // Reboot on the chosen chamber's home tile (chosen once, on deletion).
      if (this.eatenChamber < 0) this.eatenChamber = this.nearestChamber(ctx);
      const home = QUARANTINE_CHAMBERS[this.eatenChamber].home;
      if (this.mover.tx === home.x && this.mover.ty === home.y) {
        this.state = 'quarantine';
        this.chamber = this.eatenChamber;
        this.frightTimer = 0;
        // Out after RESPAWN_BANISH whoever it is: the slot's release delay only
        // staggers the round start.
        this.releaseTimer = this.slot.release - RESPAWN_BANISH;
        this.bobPhase = 0;
        this.mover.speed = SPEED.daemon;
        this.mover.daemonPass = false;
        return;
      }
    }

    // 'Leaving' ends on the ring outside the vault, not on a door or a chamber
    // tile — so a daemon that already starts out there (the outside slot) is
    // clear at once, and one in a chamber must walk its side door.
    if (this.state === 'leaving' && this.mover.maze.isOutside(this.mover.tx, this.mover.ty)) {
      this.state = this.frightTimer > 0 ? 'frightened' : 'normal';
      this.mover.daemonPass = false;
    }

    // The player's daemon drives itself home once eaten, and back out.
    const autopilot = this.state === 'eaten' || this.state === 'leaving';
    if ((!this.isPlayer || autopilot) && !this.phaseActive) {
      this.lastTarget = this.targetFor(ctx);
      this.chooseDir(ctx, this.lastTarget);
    }

    this.mover.speed = this.speedFor(ctx.level);
    this.mover.update(dt);

    // Level-appropriate speed for AI daemons.
    if (!this.isPlayer && this.state === 'normal') {
      this.mover.speed = SPEED.daemon * levelSpeedUp(ctx.level);
      if (this.dashTimer > 0) this.mover.speed *= DASH_BOOST;
    }
  }
}

export const daemonStatusLine = (g: Daemon, ctx: SimContext): string => {
  if (g.state === 'eaten') return 'DELETED';
  if (g.state === 'frightened') return 'VULNERABLE';
  if (g.state === 'quarantine') return 'QUARANTINE';
  return STANCE_INFO[ctx.stance].name;
};

export const daemonColors = (): Record<DaemonId, number> => {
  const out = {} as Record<DaemonId, number>;
  for (const g of DAEMONS) out[g.id] = g.color;
  return out;
};

export const daemonById = (id: DaemonId): DaemonDef =>
  DAEMONS.find((g) => g.id === id) ?? DAEMONS[0];

export { PALETTE };
