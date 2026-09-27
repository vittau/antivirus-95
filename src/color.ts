/** Linear blend of two 0xRRGGBB colours. */
export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

/** Blend across an ordered list of stops. */
export function sampleGradient(stops: number[], t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const scaled = k * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  return lerpColor(stops[i], stops[i + 1], scaled - i);
}
