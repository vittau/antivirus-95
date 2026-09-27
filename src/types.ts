export type Dir = 'up' | 'down' | 'left' | 'right' | 'none';
export type UnitDir = Exclude<Dir, 'none'>;

export interface Vec2 {
  x: number;
  y: number;
}

export interface TilePos {
  x: number;
  y: number;
}

export type DaemonId = 'volt' | 'relay' | 'null' | 'halt';
export type Stance = 'hunt' | 'ambush' | 'flank' | 'guard';
export type DaemonState = 'quarantine' | 'leaving' | 'normal' | 'frightened' | 'eaten';

export type GamePhase =
  | 'menu'
  | 'ready'
  | 'playing'
  | 'dying'
  | 'levelclear'
  | 'gameover'
  | 'paused';

export const DIRS: Record<UnitDir, Vec2> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

// Classic tie-break preference: up, left, down, right.
export const DIR_ORDER: UnitDir[] = ['up', 'left', 'down', 'right'];

export const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
  none: 'none',
};

export const isOpposite = (a: Dir, b: Dir): boolean => a !== 'none' && a === OPPOSITE[b];

export const dirVec = (d: Dir): Vec2 => (d === 'none' ? { x: 0, y: 0 } : DIRS[d]);

export const addTile = (a: TilePos, b: Vec2, scale = 1): TilePos => ({
  x: a.x + b.x * scale,
  y: a.y + b.y * scale,
});
