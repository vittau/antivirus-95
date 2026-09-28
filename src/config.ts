// ---------------------------------------------------------------------------
// Antivirus 95 — global configuration: dimensions, palette, daemon roster.
// ---------------------------------------------------------------------------

import type { Dir, DaemonId, Stance, TilePos, Vec2 } from './types';

// ---------------------------------------------------------------------------
// Layout. A wide 16:10-ish canvas: the maze lives in a vertically-scrolling
// viewport on the left, and a tall HUD panel occupies the right column.
// ---------------------------------------------------------------------------
export const TILE = 35;
export const COLS = 28;
export const ROWS = 31;

export const WORLD_W = COLS * TILE; // 980
export const WORLD_H = ROWS * TILE; // 1085

/** Height is fixed; width adapts to the window aspect so nothing is stretched. */
export const SCREEN_H = 760;
export let SCREEN_W = 1280;
export let HUD_W = 320;
export let VIEW_W = SCREEN_W - HUD_W;

/** Maze zoom so the board always fills the viewport width. */
export let MAZE_ZOOM = 1;
export let MAZE_OFFSET_X = 0;
/** Maximum vertical camera scroll (in world pixels). */
export let CAM_MAX = 0;

/**
 * Recompute the layout for a given window width. Keeping the logical aspect
 * equal to the window aspect means the canvas maps 1:1 with no letterbox and
 * no non-uniform stretching.
 */
export function setViewportWidth(width: number): void {
  SCREEN_W = Math.max(1040, Math.round(width));
  HUD_W = Math.max(350, Math.min(480, Math.round(SCREEN_W * 0.26)));
  VIEW_W = SCREEN_W - HUD_W;
  MAZE_ZOOM = Math.min(2.2, VIEW_W / WORLD_W);
  MAZE_OFFSET_X = (VIEW_W - WORLD_W * MAZE_ZOOM) / 2;
  CAM_MAX = Math.max(0, WORLD_H - SCREEN_H / MAZE_ZOOM);
}

// Speeds are expressed in tiles per second (classic arcade feel).
export const SPEED = {
  virus: 8.6,
  virusPowered: 9.6,
  virusFury: 10.2, // powered and closing in on its prey
  daemon: 8.4,
  daemonEaten: 15.0,
  playerDaemon: 8.6,
};

/** Daemons slow to this fraction of their speed in the side tunnel. */
export const TUNNEL_SLOW = 0.55;

/**
 * Frightened daemons run at this fraction of their own normal speed: now full
 * speed, since power pellets come back (POWER_RESPAWN). A powered virus
 * still closes ~7 tiles over FRIGHT_TIME (1.0 tiles/s faster than the
 * player's 8.6), well under the maze's median path distance of 20. A flat 5.2
 * would let it close 33+ (anywhere in reach); 0.97, ~9.
 */
export const FRIGHT_SLOW = 1.0;

export const FRIGHT_TIME = 7.5;
/** Seconds until an eaten power pellet comes back; its spot blinks for the last POWER_WARN. */
export const POWER_RESPAWN = 30;
export const POWER_WARN = 5;
export const FRIGHT_FLASH = 2.2;

export const VIRUS_LIVES = 3; // times you must quarantine the virus to clear a level
export const PLAYER_LIVES = 3; // lost each time the virus deletes your daemon
export const MAX_LIVES = 3; // extra lives stop here
export const EXTRA_LIFE_EVERY = 10000; // points per extra life
export const RESPAWN_BANISH = 4.5; // seconds a caught daemon sits in the quarantine
export const READY_TIME = 2.0;

export const ABILITY_TIME = 1.4;
export const BLIND_TIME = 2.5; // HALT's FREEZE
export const PHASE_TIME = 5.0; // NULL's BYPASS: seconds it lasts; still in a wall then, it's pushed out
export const PHASE_WARN = 3.0; // ...and when it starts blinking

// Scatter / chase schedule (classic flavour).
export const MODE_SCHEDULE: Array<{ mode: 'scatter' | 'chase'; time: number }> = [
  { mode: 'scatter', time: 7 },
  { mode: 'chase', time: 20 },
  { mode: 'scatter', time: 7 },
  { mode: 'chase', time: 20 },
  { mode: 'scatter', time: 5 },
  { mode: 'chase', time: 20 },
  { mode: 'scatter', time: 5 },
  { mode: 'chase', time: Infinity },
];

// Vaporwave palette. Hot pink → cyan gradients, sunset chrome, deep violet.
export const PALETTE = {
  bg: 0x1a0b34,
  bgDeep: 0x0a0318,
  wallTop: 0xff3fb0,
  wallBot: 0x00e5ff,
  wall: 0xff3fb0,
  wallDim: 0x6a2b8f,
  wallFill: 0x14062b,
  dot: 0xffe3fb,
  power: 0x7dfcff,
  // The virus: an acid-green cell with a ring of knobbly spikes.
  virus: 0x05ffa1,
  virusLight: 0x8dffc9,
  virusDark: 0x0aa865,
  virusLine: 0x0a3d27,
  virusStem: 0x0a7a4a,
  virusSpot: 0x0a9e5e,
  virusFrost: 0x9ff7d0,
  // EXPLOIT (powered): a red body with longer, gold-tipped spikes.
  virusHot: 0xff8fb8,
  virusHotDark: 0xb0103f,
  virusHotLine: 0x5a0620,
  // CORRUPTED daemons: the colour drains out, RGB noise takes over.
  corrupted: 0x2b1f4a,
  corruptFlash: 0xfff0ff,
  corruptBrow: 0xd9b8ff,
  sweat: 0x7dfcff,
  // HALT's FREEZE: the translucent ice block.
  ice: 0xbff4ff,
  iceEdge: 0xe8fdff,
  // The FIREWALL door: alternating hot bricks with flame tips.
  brickA: 0xff2d6e,
  brickB: 0xff9f43,
  flame: 0xffc94d,
  eyeWhite: 0xf7f4ff,
  eyePupil: 0x24104a,
  text: 0xffe6ff,
  textDim: 0x9d7fc4,
  accent: 0xff4fd8,
  accent2: 0x00e5ff,
  danger: 0xff2d6e,
  gold: 0xffc94d,
  fruit: 0xff5470,
  white: 0xffffff,
  chrome0: 0xbff4ff,
  chrome1: 0xffffff,
  chrome2: 0xd9b8ff,
  sunTop: 0xffd76a,
  sunMid: 0xff6fb0,
  sunBot: 0x7a2ff0,
  horizon: 0xff5f9e,
  grid: 0xff3fb0,
};

/**
 * Playfield colours, one per level (cycling): the neon tube runs from `top` to
 * `bottom` down the board, wall interiors from `fillTop` to `fillBottom`, and
 * `accent` tints the wall texture. All drawn from the vaporwave canon — hot
 * pink, cyan, mint, lavender, sunset gold — so every level stays on-style.
 */
export interface FieldTheme {
  top: number;
  bottom: number;
  fillTop: number;
  fillBottom: number;
  accent: number;
}

export const LEVEL_THEMES: FieldTheme[] = [
  // Neon: hot pink over cyan.
  { top: 0xff3fb0, bottom: 0x00e5ff, fillTop: 0x120727, fillBottom: 0x1f0c3c, accent: 0x00e5ff },
  // Sunset: gold melting into rose.
  { top: 0xffc94d, bottom: 0xff3f8e, fillTop: 0x1f0a1e, fillBottom: 0x2b0b2c, accent: 0xff9f43 },
  // Miami: mint over flamingo pink.
  { top: 0x05ffa1, bottom: 0xff71ce, fillTop: 0x0a1a26, fillBottom: 0x1d0d33, accent: 0x05ffa1 },
  // Ultraviolet: lavender over electric blue.
  { top: 0xb967ff, bottom: 0x01cdfe, fillTop: 0x150a35, fillBottom: 0x0b1540, accent: 0xb967ff },
  // Outrun: laser red into deep violet.
  { top: 0xff2d6e, bottom: 0x8a3bff, fillTop: 0x1d0619, fillBottom: 0x170a3c, accent: 0xff2d6e },
  // Vapor: pale lemon over lilac.
  { top: 0xfffb96, bottom: 0xb967ff, fillTop: 0x1a1430, fillBottom: 0x170b35, accent: 0xfffb96 },
];

export const themeForLevel = (level: number): FieldTheme =>
  LEVEL_THEMES[(Math.max(1, level) - 1) % LEVEL_THEMES.length];

// Synthwave sky / floor gradient stops.
export const SKY = {
  top: 0x0a0318,
  upper: 0x2a0a4a,
  mid: 0x5b1d6e,
  lower: 0x8a2a7a,
  horizon: 0xff5f9e,
  floor: 0x1a0b34,
};

export interface DaemonDef {
  id: DaemonId;
  name: string;
  color: number;
  colorDark: number;
  ability: 'dash' | 'warp' | 'phase' | 'blind';
  abilityName: string;
  abilityDesc: string;
  cooldown: number;
  blurb: string;
}

export const DAEMONS: DaemonDef[] = [
  {
    id: 'volt',
    name: 'VOLT',
    color: 0xff3fb0,
    colorDark: 0xb0226f,
    ability: 'dash',
    abilityName: 'OVERCLOCK',
    abilityDesc: 'Burst of raw speed',
    cooldown: 8,
    blurb: 'Runs hot. Always on your tail.',
  },
  {
    id: 'relay',
    name: 'RELAY',
    color: 0x00e5ff,
    colorDark: 0x0a8aa0,
    ability: 'warp',
    abilityName: 'HYPERLINK',
    abilityDesc: 'Jump to the corridor end',
    cooldown: 6,
    blurb: "Already there. You're late.",
  },
  {
    id: 'null',
    name: 'NULL',
    color: 0xb967ff,
    colorDark: 0x5e2aa8,
    ability: 'phase',
    abilityName: 'BYPASS',
    abilityDesc: 'Through one wall',
    cooldown: 8,
    blurb: 'Walls are just suggestions.',
  },
  {
    id: 'halt',
    name: 'HALT',
    color: 0xffc94d,
    colorDark: 0xb8741a,
    ability: 'blind',
    abilityName: 'FREEZE',
    abilityDesc: 'Freeze the virus for 2.5s',
    cooldown: 10,
    blurb: "Now it's not responding.",
  },
];

export const STANCE_ORDER: Stance[] = ['hunt', 'ambush', 'flank', 'guard'];

export const STANCE_INFO: Record<Stance, { name: string; desc: string; key: string }> = {
  hunt: { name: 'TRACE', desc: 'Direct trace', key: '1' },
  ambush: { name: 'INTERCEPT', desc: 'Cut it off', key: '2' },
  flank: { name: 'ISOLATE', desc: 'Close its route', key: '3' },
  guard: { name: 'FIREWALL', desc: 'Guard the disks', key: '4' },
};

export const FONT_FAMILY = '"Press Start 2P", ui-monospace, Menlo, monospace';

// Starting tiles. The virus's is each maze's P (see levels.ts); it sets off left.
export const VIRUS_START_DIR: Dir = 'left';

/**
 * The quarantine is two 2x3 chambers either side of a solid server core, each
 * with a firewall door ('=') in its side wall; the top wall is closed, so the
 * virus cannot slip in from above. A deleted daemon reboots in the chamber
 * nearest it, then leaves through that chamber's own door onto the ring.
 */
export interface QuarantineChamber {
  /** The firewall door tile in this chamber's side wall. */
  door: TilePos;
  /** The ring tile just outside the door; 'leaving' ends here. */
  exit: TilePos;
  /** Where a deleted daemon reboots, inside the chamber. */
  home: TilePos;
}

export const QUARANTINE_CHAMBERS: readonly QuarantineChamber[] = [
  { door: { x: 10, y: 14 }, exit: { x: 9, y: 14 }, home: { x: 11, y: 14 } }, // left
  { door: { x: 17, y: 14 }, exit: { x: 18, y: 14 }, home: { x: 16, y: 14 } }, // right
];

/** The player daemon starts outside, on the ring above the closed vault. */
export const PLAYER_START = { x: 13, y: 11 };

// Where the daemons wait inside the quarantine at a round start, and their
// release delays. `chamber` is the chamber a daemon leaves through; -1 means it
// starts on the ring outside, above the vault (like the player).
export interface QuarantineSlot {
  x: number;
  y: number;
  release: number;
  chamber: number;
}

export const QUARANTINE_SLOTS: Record<DaemonId, QuarantineSlot> = {
  volt: { x: 13, y: 11, release: 0.0, chamber: -1 },
  relay: { x: 11, y: 13, release: 1.5, chamber: 0 },
  null: { x: 15, y: 14, release: 4.5, chamber: 1 },
  halt: { x: 12, y: 14, release: 8.0, chamber: 0 },
};

// Corner scatter targets, one per daemon.
export const SCATTER: Record<DaemonId, Vec2> = {
  volt: { x: 25, y: -2 },
  relay: { x: 2, y: -2 },
  null: { x: 27, y: 32 },
  halt: { x: 0, y: 32 },
};
