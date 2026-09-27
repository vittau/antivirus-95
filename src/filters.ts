import { BloomFilter, CRTFilter } from 'pixi-filters';
import type { Filter } from 'pixi.js';
import { CrtGeomFilter } from './crt-filter';

/**
 * Soft neon bloom applied to the whole play field. Quality 3 looks the same
 * as 5 at this strength, with two fewer blur passes per axis.
 */
export function createBloom(): BloomFilter {
  return new BloomFilter({ strength: 2.2, quality: 3, kernelSize: 9 });
}

export interface CrtResult {
  filter: Filter;
  /** True when the custom crt-geom shader compiled; false = stock fallback. */
  custom: boolean;
  update(time: number): void;
  resize(w: number, h: number): void;
}

/**
 * Build the CRT pass. Prefers the custom crt-geom/Blargg filter and falls back
 * to pixi-filters' CRTFilter if the custom program can't be created.
 */
export function createCRT(): CrtResult {
  try {
    const f = new CrtGeomFilter({
      curvature: 12.5,
      scanIntensity: 0.14,
      // The RGB aperture-grille mask aliases badly when the canvas is scaled
      // to fit the window, producing diagonal colour moire. Off by default.
      maskIntensity: 0,
      // Fades to the very edges, never to black.
      vignette: 0.3,
      noise: 0.012,
      brightness: 1.13,
      bleed: 0.22,
    });
    return {
      filter: f,
      custom: true,
      update: (t) => {
        f.time = t;
      },
      resize: (w, h) => f.resize(w, h),
    };
  } catch (err) {
    console.warn('[antivirus-95] custom CRT filter failed, using fallback', err);
    const fallback = new CRTFilter({
      curvature: 2.2,
      lineWidth: 1.2,
      lineContrast: 0.18,
      verticalLine: false,
      noise: 0.03,
      noiseSize: 1.4,
      seed: Math.random(),
      vignetting: 0.26,
      vignettingAlpha: 0.6,
      vignettingBlur: 0.35,
    });
    return {
      filter: fallback,
      custom: false,
      update: (t) => {
        fallback.time = t;
      },
      resize: () => {},
    };
  }
}
