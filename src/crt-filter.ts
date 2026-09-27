import { Filter, GlProgram, defaultFilterVert } from 'pixi.js';
import { SCREEN_H, SCREEN_W } from './config';

/**
 * crt-geom / Blargg-inspired CRT post-processing.
 *
 * A single full-screen pass that reproduces the parts of cgwg's `crt-geom`
 * and Blargg's NTSC filters that matter at this scale:
 *
 *   - barrel (geom) screen curvature with blacked-out corners
 *   - horizontal RGB separation (Blargg-style colour bleed)
 *   - scanlines
 *   - aperture-grille shadow mask
 *   - vignette + animated noise
 *   - gamma-ish brightness lift
 *
 * Written as a GLSL ES 3.0 fragment program for Pixi v8's filter pipeline.
 */
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

// Pixi's filter globals. The pooled input texture can be larger than the
// frame (on a fractional devicePixelRatio the frame rounds 1px past the screen
// and falls back to a power-of-two texture), so vTextureCoord only spans
// [0, uOutputFrame.zw * uInputSize.zw] — not [0, 1]. Everything below works in
// normalised screen space and converts back when sampling; centring the warp
// on raw vTextureCoord skews the curvature off to one side.
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec4 uInputClamp;

uniform vec2 uResolution;
uniform float uTime;
uniform float uCurvature;
uniform float uScanIntensity;
uniform float uMaskIntensity;
uniform float uVignette;
uniform float uNoise;
uniform float uBrightness;
uniform float uBleed;

const float PI = 3.141592653589793;

// crt-geom style barrel warp, corrected for aspect ratio so the corner
// rounding stays circular on a widescreen canvas instead of stretching.
vec2 warp(vec2 uv) {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = uv * 2.0 - 1.0;
  vec2 q = vec2(p.x * aspect, p.y);
  vec2 off = abs(q.yx) / max(uCurvature, 0.001);
  q += q * off * off;
  q.x /= aspect;
  return q * 0.5 + 0.5;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}

vec3 sampleScreen(vec2 screenUv, vec2 uvScale) {
  vec2 t = clamp(screenUv * uvScale, uInputClamp.xy, uInputClamp.zw);
  return texture(uTexture, t).rgb;
}

void main(void) {
  vec2 uvScale = uOutputFrame.zw * uInputSize.zw;
  vec2 screen = vTextureCoord / max(uvScale, vec2(1e-6));
  vec2 uv = warp(screen);

  // Clamp rather than black out: the image runs cleanly to every edge with no
  // bezel or dark margin. Against the dark maze border the smear is invisible.
  uv = clamp(uv, vec2(0.0), vec2(1.0));

  vec2 px = 1.0 / max(uResolution, vec2(1.0));

  // Blargg-ish NTSC colour bleed: sample the channels slightly apart.
  vec3 col;
  col.r = sampleScreen(uv + vec2(px.x * uBleed, 0.0), uvScale).r;
  col.g = sampleScreen(uv, uvScale).g;
  col.b = sampleScreen(uv - vec2(px.x * uBleed, 0.0), uvScale).b;

  // Scanlines.
  float scan = 0.5 + 0.5 * sin(uv.y * uResolution.y * PI);
  col *= 1.0 - uScanIntensity * (1.0 - scan);

  // Aperture grille.
  float m = mod(floor(uv.x * uResolution.x), 3.0);
  vec3 mask = vec3(1.0);
  if (m < 1.0) mask = vec3(1.0, 0.42, 0.48);
  else if (m < 2.0) mask = vec3(0.42, 1.0, 0.52);
  else mask = vec3(0.46, 0.5, 1.0);
  col *= mix(vec3(1.0), mask, uMaskIntensity);

  // Gentle radial vignette that fades all the way to the screen edges and
  // never reaches black, so there is no abrupt band before the sides.
  if (uVignette > 0.001) {
    float d = distance(screen, vec2(0.5)) * 1.41421356;
    col *= 1.0 - uVignette * smoothstep(0.55, 1.0, d);
  }

  // Animated noise.
  col += (hash(uv * uResolution + fract(uTime) * 91.7) - 0.5) * uNoise;

  col *= uBrightness;

  finalColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export interface CrtOptions {
  curvature?: number;
  scanIntensity?: number;
  maskIntensity?: number;
  vignette?: number;
  noise?: number;
  brightness?: number;
  bleed?: number;
}

interface CrtUniforms extends Record<string, unknown> {
  uTime: number;
  uResolution: Float32Array;
  uCurvature: number;
  uScanIntensity: number;
  uMaskIntensity: number;
  uVignette: number;
  uNoise: number;
  uBrightness: number;
  uBleed: number;
}

export class CrtGeomFilter extends Filter {
  private readonly u: CrtUniforms;

  constructor(options: CrtOptions = {}) {
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'crt-geom' });
    super({
      glProgram,
      resources: {
        crtUniforms: {
          uTime: { value: 0, type: 'f32' },
          uResolution: { value: new Float32Array([SCREEN_W, SCREEN_H]), type: 'vec2<f32>' },
          uCurvature: { value: options.curvature ?? 3.0, type: 'f32' },
          uScanIntensity: { value: options.scanIntensity ?? 0.3, type: 'f32' },
          uMaskIntensity: { value: options.maskIntensity ?? 0.16, type: 'f32' },
          uVignette: { value: options.vignette ?? 0.3, type: 'f32' },
          uNoise: { value: options.noise ?? 0.035, type: 'f32' },
          uBrightness: { value: options.brightness ?? 1.1, type: 'f32' },
          uBleed: { value: options.bleed ?? 0.7, type: 'f32' },
        },
      },
    });

    this.u = (this.resources as { crtUniforms: { uniforms: CrtUniforms } }).crtUniforms.uniforms;
  }

  set time(t: number) {
    this.u.uTime = t;
  }

  set curvature(v: number) {
    this.u.uCurvature = v;
  }

  set scanIntensity(v: number) {
    this.u.uScanIntensity = v;
  }

  resize(w: number, h: number): void {
    this.u.uResolution[0] = w;
    this.u.uResolution[1] = h;
  }
}
