import { OPPOSITE } from './types';
import type { Dir, UnitDir } from './types';

/** Which device the player touched last; menus and hints follow it. */
export type InputDevice = 'keyboard' | 'gamepad';

/** Game commands, bound to both keyboard keys and gamepad buttons. */
export type Action =
  | 'up'
  | 'down'
  | 'confirm'
  | 'back'
  | 'ability'
  | 'pause'
  | 'stanceNext'
  | 'stancePrev'
  | 'nextSong'
  | 'mute';

const DIR_KEYS: Record<string, UnitDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const KEY_ACTIONS: Record<Action, readonly string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  confirm: ['Space', 'Enter', 'NumpadEnter'],
  back: [],
  ability: ['Space'],
  pause: ['KeyP', 'Escape'],
  stanceNext: ['KeyE'],
  stancePrev: ['KeyQ'],
  nextSong: ['KeyM'],
  mute: ['KeyN'],
};

/**
 * Standard Gamepad mapping: Xbox layout, which is also what Steam Input
 * presents for the Steam Deck (A B X Y, L1/R1 bumpers, L2/R2 triggers,
 * VIEW ⧉ and MENU ☰).
 */
const PAD = {
  a: 0,
  b: 1,
  y: 3,
  l1: 4,
  r1: 5,
  r2: 7,
  view: 8,
  menu: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

const PAD_ACTIONS: Record<Action, readonly number[]> = {
  up: [],
  down: [],
  confirm: [PAD.a, PAD.menu],
  back: [PAD.b],
  ability: [PAD.a, PAD.r2],
  pause: [PAD.menu],
  stanceNext: [PAD.r1],
  stancePrev: [PAD.l1],
  nextSong: [PAD.y],
  mute: [PAD.view],
};

const PAD_DIRS: ReadonlyArray<[number, UnitDir]> = [
  [PAD.up, 'up'],
  [PAD.down, 'down'],
  [PAD.left, 'left'],
  [PAD.right, 'right'],
];

/** Stick deflection that registers a direction, and the lower one that holds it. */
const STICK_ON = 0.5;
const STICK_HOLD = 0.35;
/** Analog triggers report a value; count them as pressed past this. */
const TRIGGER_ON = 0.5;

const SWALLOW = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

const top = (stack: UnitDir[]): UnitDir | undefined => stack[stack.length - 1];

/**
 * Keyboard and gamepad state with edge detection. Direction presses are
 * tracked as a stack per device so the most recently pressed one wins
 * (classic arcade style input), while commands expose one-shot `pressed` queries.
 * Gamepads are polled: call `poll()` once per frame before reading.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly justDown = new Set<string>();
  private keyStack: UnitDir[] = [];

  private padButtons = new Set<number>();
  private readonly padJust = new Set<number>();
  private padDirs = new Set<UnitDir>();
  private readonly padDirJust = new Set<UnitDir>();
  private padStack: UnitDir[] = [];
  private stick: UnitDir | null = null;

  /** The device that produced the latest press. */
  lastDevice: InputDevice = 'keyboard';

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (SWALLOW.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.lastDevice = 'keyboard';
      this.down.add(e.code);
      this.justDown.add(e.code);
      const d = DIR_KEYS[e.code];
      if (d) {
        this.keyStack = this.keyStack.filter((x) => x !== d);
        this.keyStack.push(d);
      }
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      const d = DIR_KEYS[e.code];
      if (d) this.keyStack = this.keyStack.filter((x) => x !== d);
    });
    target.addEventListener('blur', () => {
      this.down.clear();
      this.keyStack = [];
    });
  }

  /** Read every connected gamepad and record this frame's presses. */
  poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const buttons = new Set<number>();
    const dirs = new Set<UnitDir>();
    let x = 0;
    let y = 0;
    for (const pad of pads) {
      if (!pad?.connected) continue;
      pad.buttons.forEach((b, i) => {
        if (b.pressed || b.value > TRIGGER_ON) buttons.add(i);
      });
      // Several pads (or a pad plus a stray virtual one): the stronger stick wins.
      const [ax = 0, ay = 0] = pad.axes;
      if (Math.hypot(ax, ay) > Math.hypot(x, y)) {
        x = ax;
        y = ay;
      }
    }

    for (const [button, d] of PAD_DIRS) if (buttons.has(button)) dirs.add(d);
    this.stick = this.stickDir(x, y);
    if (this.stick) dirs.add(this.stick);

    for (const b of buttons) if (!this.padButtons.has(b)) this.padJust.add(b);
    for (const d of dirs) {
      if (this.padDirs.has(d)) continue;
      this.padDirJust.add(d);
      this.padStack = this.padStack.filter((s) => s !== d);
      this.padStack.push(d);
    }
    this.padStack = this.padStack.filter((d) => dirs.has(d));
    if (this.padJust.size || this.padDirJust.size) this.lastDevice = 'gamepad';

    this.padButtons = buttons;
    this.padDirs = dirs;
  }

  /** Dominant stick direction, with hysteresis so a held diagonal doesn't flicker. */
  private stickDir(x: number, y: number): UnitDir | null {
    const along = (d: UnitDir): number =>
      d === 'left' ? -x : d === 'right' ? x : d === 'up' ? -y : y;
    if (this.stick && along(this.stick) > STICK_HOLD) {
      const horizontal = this.stick === 'left' || this.stick === 'right';
      const main = Math.abs(horizontal ? x : y);
      const cross = Math.abs(horizontal ? y : x);
      if (main >= cross * 0.8) return this.stick;
    }
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK_ON) return null;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'down' : 'up';
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** A keyboard key went down this frame (for keyboard-only toggles). */
  justPressed(code: string): boolean {
    return this.justDown.has(code);
  }

  /** A command was triggered this frame, from any device. */
  pressed(action: Action): boolean {
    if (KEY_ACTIONS[action].some((c) => this.justDown.has(c))) return true;
    if (PAD_ACTIONS[action].some((b) => this.padJust.has(b))) return true;
    return (action === 'up' || action === 'down') && this.padDirJust.has(action);
  }

  /** Most recently pressed direction, preferring the device in use. */
  get wantDir(): Dir {
    const key = top(this.keyStack);
    const pad = top(this.padStack);
    return (this.lastDevice === 'gamepad' ? (pad ?? key) : (key ?? pad)) ?? 'none';
  }

  /** Grid direction from a code, if it is a direction key. */
  dirOf(code: string): Dir {
    return DIR_KEYS[code] ?? 'none';
  }

  clearPresses(): void {
    this.justDown.clear();
    this.padJust.clear();
    this.padDirJust.clear();
  }
}

export { OPPOSITE };
