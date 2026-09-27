import { Application } from 'pixi.js';
import './style.css';
import { PALETTE, SCREEN_H, SCREEN_W, setViewportWidth } from './config';
import { Input } from './input';
import { Game } from './game';

/**
 * Keep the total pixel count sane so bloom + CRT stay affordable, but never
 * below 1: a sub-1 resolution cuts the bottom off the bloom under the CRT.
 */
const MAX_PIXELS = 3_200_000;

function resolutionFor(w: number, h: number): number {
  const dpr = window.devicePixelRatio || 1;
  const budget = Math.sqrt(MAX_PIXELS / Math.max(1, w * h));
  return Math.max(1, Math.min(2, dpr, budget));
}

/**
 * The canvas height is fixed and the width follows the window aspect, so the
 * logical canvas maps 1:1 onto the window: no letterbox and no stretching.
 */
function widthForWindow(): number {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  return Math.round(SCREEN_H * aspect);
}

/**
 * True where audio may start without a user gesture: the desktop build turns
 * the autoplay policy off. Browsers keep a fresh AudioContext suspended, and
 * a blocked resume() never settles, hence the timeout.
 */
async function autoplayAllowed(): Promise<boolean> {
  try {
    const ctx = new AudioContext();
    const ok =
      ctx.state === 'running' ||
      (await Promise.race([
        ctx.resume().then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((r) => setTimeout(() => r(false), 250)),
      ]));
    void ctx.close();
    return ok;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  try {
    await document.fonts.load('16px "Press Start 2P"');
    await document.fonts.ready;
  } catch {
    /* fall back to monospace */
  }

  setViewportWidth(widthForWindow());

  const app = new Application();
  await app.init({
    width: SCREEN_W,
    height: SCREEN_H,
    background: PALETTE.bg,
    antialias: true,
    resolution: resolutionFor(SCREEN_W, SCREEN_H),
    autoDensity: false,
    preference: 'webgl',
    // Lets backdrop filters read what's already drawn (the title screen's
    // frosted header and panel).
    useBackBuffer: true,
    powerPreference: 'high-performance',
  });
  // No frame cap: the ticker runs on requestAnimationFrame, which the browser
  // paces to the display's refresh (v-sync). A fixed 60 cap on a 120/144 Hz
  // screen drops frames unevenly and judders. Everything steps by real dt.
  app.ticker.maxFPS = 0;

  // Milestone for the desktop shell's launch log.
  console.info(`[antivirus-95] renderer up: ${app.renderer.name} ${app.renderer.width}x${app.renderer.height}`);

  document.getElementById('loading')?.remove();
  const mount = document.getElementById('app') ?? document.body;
  mount.appendChild(app.canvas);

  const input = new Input();
  const game = new Game(app);
  let accMs = 0;
  let frames = 0;
  let fpsReports = 3;
  let cursor = '';

  const fit = (): void => {
    setViewportWidth(widthForWindow());
    app.renderer.resolution = resolutionFor(SCREEN_W, SCREEN_H);
    app.renderer.resize(SCREEN_W, SCREEN_H);
    game.layout();
  };
  window.addEventListener('resize', fit);

  // Audio can only start from a user gesture.
  const unlock = (): void => {
    game.unlockAudio();
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);
  void autoplayAllowed().then((ok) => {
    if (ok) unlock();
  });

  app.ticker.add((ticker) => {
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    input.poll();
    game.update(dt, input);
    // No stray pointer over the maze while playing on a controller.
    const wantCursor = input.lastDevice === 'gamepad' ? 'none' : '';
    if (wantCursor !== cursor) app.canvas.style.cursor = cursor = wantCursor;

    // The first few frame-rate samples go to the desktop shell's launch log.
    // (There is no automatic quality drop: its sub-1 render resolution broke
    // the bloom under the CRT pass, and the Deck holds full quality anyway.)
    if (fpsReports > 0) {
      accMs += ticker.deltaMS;
      frames++;
      if (frames >= 150) {
        fpsReports--;
        const avgFps = 1000 / (accMs / frames);
        console.info(`[antivirus-95] fps ${avgFps.toFixed(1)} at resolution ${app.renderer.resolution}`);
        accMs = 0;
        frames = 0;
      }
    }
  });

  // Handy for debugging from the console.
  (window as unknown as Record<string, unknown>).antivirus95 = { app, game, input };
}

boot().catch((err: unknown) => {
  console.error('[antivirus-95] failed to start', err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'FAILED TO START — CHECK THE CONSOLE';
});
