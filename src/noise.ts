// Cheap value noise. Sampling it with a slowly advancing offset gives smoothly
// correlated, drifting variation — neighbours rise and fall together, which
// reads as organic rather than blinking.
const fade = (t: number): number => t * t * (3 - 2 * t);

/** Hash of an integer lattice point to [0, 1). */
export const lattice = (ix: number, iy: number, seed: number): number => {
  const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Smooth 2D value noise in [0, 1]. */
export const valueNoise = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
};
