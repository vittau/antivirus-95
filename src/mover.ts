import { COLS, ROWS, TILE } from './config';
import { Maze, WALL, DOOR } from './maze';
import { DIRS, OPPOSITE, isOpposite } from './types';
import type { Dir, TilePos, UnitDir } from './types';

export const centerOf = (tile: number): number => tile * TILE + TILE / 2;

/**
 * Grid-locked movement.
 *
 * An actor always sits between the centre of tile (tx,ty) and the centre of
 * (tx,ty)+dir, at progress `t` in [0,1]. Pixel position is a pure function of
 * (tx, ty, dir, t), so there is zero floating-point drift and turning is exact.
 * This is the model that makes the virus-style movement feel crisp.
 */
export class Mover {
  tx = 0;
  ty = 0;
  dir: Dir = 'none';
  t = 0;
  speed = 1; // tiles per second
  want: Dir = 'none';
  phase = false; // pass through walls (NULL's BYPASS)
  daemonPass = false; // may traverse the daemon door
  onArrive: ((tx: number, ty: number) => void) | null = null;

  constructor(public readonly maze: Maze) {}

  get px(): number {
    if (this.dir === 'none') return centerOf(this.tx);
    return centerOf(this.tx) + DIRS[this.dir as UnitDir].x * TILE * this.t;
  }

  get py(): number {
    if (this.dir === 'none') return centerOf(this.ty);
    return centerOf(this.ty) + DIRS[this.dir as UnitDir].y * TILE * this.t;
  }

  get tile(): TilePos {
    return { x: this.tx, y: this.ty };
  }

  get currentKind(): number {
    return this.maze.kindAt(this.tx, this.ty);
  }

  atCenter(): boolean {
    return this.t === 0;
  }

  place(x: number, y: number, dir: Dir): void {
    this.tx = x;
    this.ty = y;
    this.dir = dir;
    this.want = 'none';
    this.t = 0;
  }

  canEnter(dir: UnitDir): boolean {
    return this.canEnterFrom(this.tx, this.ty, dir);
  }

  /** Could this actor step from tile (x,y) into `dir`? */
  canEnterFrom(x: number, y: number, dir: UnitDir): boolean {
    const d = DIRS[dir];
    const nr = y + d.y;
    if (nr < 0 || nr >= ROWS) return false;
    let nc = x + d.x;
    if (nc < 0) nc = COLS - 1;
    else if (nc >= COLS) nc = 0;
    const k = this.maze.kindAt(nc, nr);
    // PHASE passes inner walls only: the outer border stays solid, so it can't
    // wrap round the outside of the board.
    if (k === WALL) return this.phase && nr > 0 && nr < ROWS - 1 && nc > 0 && nc < COLS - 1;
    if (k === DOOR) return this.daemonPass;
    return true;
  }

  private wrap(): void {
    if (this.tx < 0) this.tx = COLS - 1;
    else if (this.tx >= COLS) this.tx = 0;
  }

  /** Flip direction in place, preserving the rendered position exactly. */
  reverse(): void {
    if (this.dir === 'none') return;
    const d = DIRS[this.dir as UnitDir];
    this.tx += d.x;
    this.ty += d.y;
    this.dir = OPPOSITE[this.dir];
    this.t = 1 - this.t;
    this.wrap();
  }

  /**
   * The tile where this actor's next turn can happen: the tile it is standing
   * on at a centre, otherwise the one it is heading into.
   */
  get nextTile(): TilePos {
    if (this.dir === 'none' || this.t === 0) return { x: this.tx, y: this.ty };
    const d = DIRS[this.dir as UnitDir];
    let x = this.tx + d.x;
    if (x < 0) x = COLS - 1;
    else if (x >= COLS) x = 0;
    return { x, y: this.ty + d.y };
  }

  /** May this actor turn into `dir` right now? */
  private tryTurn(): void {
    if (this.want === 'none' || this.want === this.dir) return;
    if (isOpposite(this.want, this.dir)) {
      this.reverse();
    } else if (this.t === 0 && this.canEnter(this.want as UnitDir)) {
      this.dir = this.want;
    }
  }

  update(dt: number): void {
    let step = this.speed * dt;
    if (step <= 0 || !Number.isFinite(step)) return;

    for (let guard = 0; guard < 8; guard++) {
      this.tryTurn();

      if (this.dir === 'none') {
        if (this.want !== 'none' && this.canEnter(this.want as UnitDir)) {
          this.dir = this.want;
        } else {
          return;
        }
      }

      const d = DIRS[this.dir as UnitDir];

      if (this.t === 0 && !this.canEnter(this.dir as UnitDir)) {
        this.dir = 'none';
        return;
      }

      const move = Math.min(step, 1 - this.t);
      const arrived = this.t + move >= 1 - 1e-9;
      this.t += move;
      step -= move;

      if (!arrived) return;

      this.tx += d.x;
      this.ty += d.y;
      this.t = 0;
      this.wrap();
      this.onArrive?.(this.tx, this.ty);
      if (step <= 1e-9) return;
    }
  }
}
