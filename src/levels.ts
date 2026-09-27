import { COLS, ROWS } from './config';
import type { TilePos } from './types';

/**
 * The mazes, one plain-text file each in `src/levels/` (the format is spelled
 * out at the top of every file). Levels play them in file-name order and
 * start over after the last.
 */
export interface LevelDef {
  /** File name, for error messages. */
  file: string;
  name: string;
  /** ROWS strings of COLS characters (`#`, `.`, `o`, `=`, space); `P` becomes a space. */
  rows: string[];
  virusStart: TilePos;
}

/**
 * The quarantine and the ring of floor around it (rows 11-17, columns 9-18).
 * Two 2x3 chambers sit either side of a solid 2x3 server core, each with a
 * firewall door ('=') in its side wall; the top wall is closed. The AI's
 * quarantine slots, doors and exit paths are built around this block, so every
 * maze must keep it exactly.
 */
const QUARANTINE_TOP = 11;
const QUARANTINE_LEFT = 9;
const QUARANTINE = [
  '          ',
  ' ######## ',
  ' #  ##  # ',
  ' =  ##  = ',
  ' #  ##  # ',
  ' ######## ',
  '          ',
];

const TILES = new Set(['#', '.', 'o', '=', ' ', 'P']);

export function parseLevel(file: string, text: string): LevelDef {
  const fail = (msg: string): never => {
    throw new Error(`${file}: ${msg}`);
  };
  let name = file;
  const rows: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('//')) continue;
    const header = rows.length === 0 && /^(\w+):\s*(.*)$/.exec(line);
    if (header) {
      if (header[1] === 'name') name = header[2].trim();
      continue;
    }
    if (rows.length === 0 && line.trim() === '') continue;
    rows.push(line);
  }
  while (rows.length && rows[rows.length - 1].trim() === '') rows.pop();
  if (rows.length !== ROWS) fail(`${rows.length} rows, expected ${ROWS}`);

  const starts: TilePos[] = [];
  const grid = rows.map((line, r) => {
    // Editors strip trailing spaces; a short row is padded with floor.
    if (line.length > COLS) fail(`row ${r + 1} is ${line.length} columns wide, expected ${COLS}`);
    const row = line.padEnd(COLS, ' ');
    for (let c = 0; c < COLS; c++) {
      if (!TILES.has(row[c])) fail(`row ${r + 1}, column ${c + 1}: unknown tile '${row[c]}'`);
      if (row[c] === 'P') starts.push({ x: c, y: r });
    }
    return row.replace('P', ' ');
  });
  if (starts.length !== 1) fail(`${starts.length} P tiles (the virus's start), expected one`);

  QUARANTINE.forEach((want, i) => {
    const r = QUARANTINE_TOP + i;
    if (grid[r].slice(QUARANTINE_LEFT, QUARANTINE_LEFT + want.length) !== want) {
      fail(
        `row ${r + 1}: the quarantine (columns ${QUARANTINE_LEFT + 1}-${QUARANTINE_LEFT + want.length}) must keep its two chambers and side doors`,
      );
    }
  });
  grid.forEach((row, r) => {
    if ((row[0] === '#') !== (row[COLS - 1] === '#')) fail(`row ${r + 1} is open at one edge only`);
  });

  return { file, name, rows: grid, virusStart: starts[0] };
}

const files = import.meta.glob<string>('./levels/*.maze', { query: '?raw', import: 'default', eager: true });

export const LEVELS: LevelDef[] = Object.keys(files)
  .sort()
  .map((path) => parseLevel(path.slice(path.lastIndexOf('/') + 1), files[path]));

/** The maze for a level number (1-based), cycling through the list. */
export const levelFor = (level: number): LevelDef => LEVELS[(Math.max(1, level) - 1) % LEVELS.length];
