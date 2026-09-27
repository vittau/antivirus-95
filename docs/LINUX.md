# Linux and Steam Deck notes

What we learned getting the Electron build to run on a Steam Deck, for the
next agent who touches `electron/`, `build/linux/antivirus-95` or the release
workflow. It records what was **observed on the device** (logs the owner ran
and pasted back), what was **inferred**, and what is still **open**. None of
it could be reproduced on the Mac except where noted, so test on a Deck
before believing a fix.

## The setup that works (since v0.1.4)

| | Desktop Mode | Gaming Mode |
| --- | --- | --- |
| Session | KDE Plasma, **Wayland** (`DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`) | gamescope, **X11 only** (`DISPLAY=:1`, no `WAYLAND_DISPLAY`) |
| Started by | Konsole, or Steam | Steam (`SteamGameId`, `SteamAppId`, `SteamDeck=1`, `SteamOS=1` set) |
| Chromium platform | Wayland (Chromium's own pick) | X11 |
| WebGL | ANGLE on Vulkan (RADV) | ANGLE on Vulkan (RADV) |
| Compositing | GPU | **software** (`--disable-gpu-compositing`) |
| Sandbox | on | **off** when Steam starts it (`--no-sandbox`) |

The chain: Steam or the shell runs `Antivirus 95/antivirus-95`, which is the
launcher script from `build/linux/antivirus-95`. The launcher logs, cleans the
environment, adds flags, and `exec`s `Antivirus 95/antivirus-95-bin`, the Electron
binary. Then `electron/main.js` adds the SteamOS GPU switches and writes its
own log.

Where each decision lives:

- `build/linux/antivirus-95`: clears `LD_PRELOAD` and `LD_LIBRARY_PATH`. When
  Steam starts it (`SteamGameId` set), it adds `--no-sandbox`, plus
  `--disable-gpu-compositing` if there is no `WAYLAND_DISPLAY`. It appends
  `$ANTIVIRUS95_FLAGS`.
- `electron/main.js`: on SteamOS (`ID=steamos` in `/etc/os-release`), and
  unless `--use-angle` was given, it adds `--use-angle=vulkan
  --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan`. It shows
  the window at once (not on `ready-to-show`) and logs.
- `src/main.ts`: render resolution is never below 1, there is no automatic
  quality drop, and it logs the first three FPS samples.

## Logs: where and how to read them

All three live in `~/.config/Antivirus 95/`. The folder follows `productName` in `package.json`; before that was set it followed the package name.

| File | Written by | Lifetime | Contents |
| --- | --- | --- | --- |
| `launch.log` | the launcher | **rewritten** every launch | args, the `LD_*` and Steam/session variables it saw, the flags it added, the final `exec antivirus-95-bin …` line, then all of the binary's stdout/stderr (Chromium errors, `[Gamescope WSI]` layer chatter) |
| `antivirus-95.log` | `main.js` | **rewritten** every launch | start (version, argv, env), GPU feature status, `child process gone`, page load, renderer console (`[antivirus-95] renderer up: webgl 1216x760`, `[antivirus-95] fps …`) |
| `chromium.log` | Chromium (`--log-file`) | **appends** across launches | Chromium's own log; filter by the PID or timestamp you care about |

Reading them:

- **If `launch.log` is not from the launch you just made** (check its
  timestamp and args), the launcher never ran. The problem is before the
  game, in how it was started.
- **If `launch.log` is fresh but `antivirus-95.log` is stale or empty**, the
  binary hung or died before `main.js` ran: sandbox, libraries, or GPU
  process start.
- **`renderer up: webgl …` is the line that matters.** `renderer up:
  canvas` means the GPU process died and Pixi fell back to Canvas2D. All
  filters are then skipped (`filter "…" is not supported in Canvas2D`), so
  rendering bugs "disappear" without being fixed.
- `child process gone {"type":"GPU","reason":"abnormal-exit"}` three times
  in a row means Chromium gave up on the GPU.
- Read the logs **before launching again**, because the first two are
  overwritten. The owner reads them in Desktop Mode after a Gaming Mode
  attempt.

## Findings, in the order we hit them

### 1. Gaming Mode: Steam's spinner forever, Abort doesn't work (fixed in v0.1.2)

- **Observed.**
  - Steam's launch spinner never cleared, and *Abort Game* did nothing.
  - The only way out was the power menu → Restart, and switching to Desktop
    Mode afterwards took a long time.
  - No music played.
  - The attempt **wrote nothing to `antivirus-95.log`**, so `main.js` never ran.
  - The same build ran fine from Konsole in Desktop Mode.
- **Environment Steam passes** (captured later by the launcher):
  `LD_PRELOAD=:…/ubuntu12_32/gameoverlayrenderer.so:…/ubuntu12_64/gameoverlayrenderer.so`.
  `LD_LIBRARY_PATH` was empty in the captures we have.
- **Fix.** The launcher script clears `LD_PRELOAD` and `LD_LIBRARY_PATH` and
  adds `--no-sandbox` when `SteamGameId` is set. With v0.1.2, Gaming Mode
  started: sound and controller worked, and the screen was black (finding 4).
- **Not isolated:** which of the three changes mattered. The owner
  remembered Chromium in Steam needing `--no-sandbox`. That fits the
  "hangs before `main.js`" symptom, because the zygote/sandbox starts before
  JS. It is still unproven. v0.1.1 had also moved window showing off
  `ready-to-show` and pinned ANGLE on OpenGL; neither changed the spinner.

### 2. Black triangle in the lower right (fixed by ANGLE on Vulkan)

- **Observed** in Desktop Mode with Chromium's default (ANGLE on OpenGL,
  Mesa radeonsi):
  - a solid triangle of background colour covers the lower right of the
    whole screen, HUD included;
  - its edge runs from about the bottom-left corner to about a quarter of
    the way up the right edge, so it is *not* a screen diagonal.
- **Inference.**
  - It spans the HUD, so it comes from a full-screen pass: the CRT filter on
    `app.stage`, or the back-buffer present (`useBackBuffer: true`), which
    Pixi draws as one oversized triangle (`GlBackBufferSystem`).
  - The CRT shader clamps its sampling and writes alpha 1, so it would smear
    rather than paint a clean triangle. That points at a triangle going
    unrasterised, or a bad vertex, in the last pass.
- **Not reproducible on macOS**, not even with `--use-angle=gl` and a forced
  low-quality mode.
- **Fix.** `--use-angle=vulkan --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan`
  renders correctly on the Deck (owner-verified, effects on). `main.js`
  applies it on SteamOS only; other Linux keeps Chromium's default.
- **Open.** Root cause in the GL path. Finding it would let Linux use OpenGL
  throughout, with GPU compositing in Gaming Mode (see finding 4). The next
  step would be a build with debug switches to turn off the CRT, bloom and
  back buffer one at a time under `--use-angle=gl`.

### 3. `--use-angle=vulkan` alone "fixed" the triangle by killing the GPU

With v0.1.1, which pinned `--disable-features=Vulkan`, passing only
`--use-angle=vulkan` crashed the GPU process three times (exit code 8704).
Chromium fell back to software and Pixi to Canvas2D (`renderer up:
canvas`). The picture had no triangle only because it had no filters at all.
Asking ANGLE for Vulkan needs the `Vulkan` feature enabled. **Lesson:**
confirm `renderer up: webgl` before calling a rendering bug fixed.

### 4. Gaming Mode: black screen after "LOADING…" (fixed in v0.1.3, at a cost)

- **Observed.**
  - The HTML "LOADING…" text shows, then black. The game is running behind
    it: music plays, controls work.
  - `launch.log` showed the Gamescope WSI Vulkan layer creating a surface
    and swapchain for the window, then `Destroying swapchain`, then nothing.
  - With `DISABLE_GAMESCOPE_WSI=1 %command%` the `[Gamescope WSI]` lines
    disappeared and it was **still black**, so that layer is not the cause.
- **Reproduced in Desktop Mode:** `./antivirus-95 --ozone-platform=x11` gives the
  same black screen. `./antivirus-95 --ozone-platform=x11 --disable-gpu-compositing`
  shows the game.
- **Cause (inferred from the above).** With the `Vulkan` feature on,
  Chromium presents GPU-composited frames through a Vulkan swapchain when
  running on X11, and on the Deck nothing reaches the screen. On Wayland it
  doesn't take that path; it logs `'--ozone-platform=wayland' is not
  compatible with Vulkan`. That is why Desktop Mode always worked and Gaming
  Mode, which is X11 only, never did.
- **Fix.** The launcher adds `--disable-gpu-compositing` when Steam starts
  the game without Wayland. WebGL stays on the GPU; the compositor reads the
  canvas back each frame (`GPU stall due to ReadPixels` in `launch.log`)
  and presents it as a plain X11 image.
- **Cost.** One 1216×760 readback per frame. The owner reports performance
  on the Deck as great. Deck FPS numbers were not captured; they are in
  `antivirus-95.log` (`[antivirus-95] fps`) if you need them.
- **ANGLE's backend is per GPU process,** so there is no "WebGL on Vulkan,
  compositor on OpenGL" option. The alternatives are software compositing
  (what we ship) or OpenGL everywhere once finding 2 is root-caused.

### 5. Band across the bottom of the maze with the CRT on (fixed in v0.1.4)

- **Observed in Gaming Mode:**
  - the CRT was off at start;
  - turning it on showed a background-coloured band across the bottom of
    the maze (not the HUD).
- **Cause, reproduced on the Mac.** `src/main.ts` had a one-way adaptive
  downgrade: under 45 fps at start, it set render resolution to 0.75 and
  turned the CRT off. The Deck tripped it while software compositing warmed
  up. At a render resolution below 1, the bloom on `world`, nested under
  the CRT on `app.stage`, loses its bottom rows. `game.layout()` does not
  fix it.
- **Fix.** The downgrade is gone, and `resolutionFor()` floors at 1, which
  also covers a browser zoomed out below 1× on the web. See AGENTS.md
  invariant 5.

### 6. Steam launch options: arguments after `%command%` never reach the game

- **Observed.** Launch options `%command% --use-angle=gl` and `%command%
  --disable-gpu-compositing` made the game "crash instantly" in Gaming Mode,
  and `launch.log` was **not rewritten**, so the launcher never ran.
  `DISABLE_GAMESCOPE_WSI=1 %command%` (variables before `%command%`) did run
  it.
- **Why:** unknown. The shortcut targets the launcher script; that is all
  we know.
- **Workaround.** The launcher reads extra flags from `ANTIVIRUS95_FLAGS`, so
  test with `ANTIVIRUS95_FLAGS="--use-angle=gl" %command%`. From Konsole, pass
  flags directly: `./antivirus-95 --flag`.

### 7. Switches that `main.js` can't set

`app.commandLine.appendSwitch('ozone-platform', 'x11')` in `main.js` had no
effect: the Desktop Mode log still showed Chromium on Wayland. The display
platform is chosen before `main.js` runs, so we removed that switch.
Platform switches belong on the real command line (launcher,
`ANTIVIRUS95_FLAGS`). `--use-angle` and `--enable-features` from `main.js` *do*
take effect, because the GPU process starts later and inherits them.

Also: the platform name is lowercase. `--ozone-platform=X11` dies at once
with `Trace/breakpoint trap (core dumped)` (a Chromium CHECK), which looks
like a crash of ours.

### 8. The controller in Desktop Mode

Started from Konsole, the game gets no gamepad. Steam's desktop layout turns
the Deck's controls into keyboard and mouse:

- the D-pad arrives as arrow keys, so movement works;
- the face buttons become keys the game doesn't use in play;
- **R2 is a left mouse click**, which cost the window its focus. The game
  releases all keys on `blur`, so the controls seemed to stop.

Started by Steam (Gaming Mode, or the library in Desktop Mode), Steam Input
exposes a virtual Xbox pad, and every binding in `src/input.ts` works
(owner-verified in Gaming Mode). To test the controller without a Deck,
override `navigator.getGamepads` over CDP (see AGENTS.md).

### 9. Packaging

- An AppImage is awkward on the Deck. We ship a `.tar.xz` of
  electron-builder's unpacked `dir` target, which CI repacks as a fixed
  `Antivirus 95/` folder: extracting an update over it keeps the Steam shortcut
  valid.
- xz −9 is about 106 MB against about 136 MB for `.tar.gz`.
- `--transform` in `release.yml` is GNU tar (Ubuntu runner). macOS bsdtar
  spells it `-s`.
- The launcher ships via `extraFiles`. The binary is renamed with
  `executableName: antivirus-95-bin` so the script can take the name
  `antivirus-95`, which is what the README tells players to add to Steam.

## Picking up the OpenGL triangle (finding 2)

**Why bother.** If Linux could stay on ANGLE's OpenGL backend, Gaming Mode
could composite on the GPU again, dropping the per-frame readback of
finding 4. It is not urgent: the owner reports performance on the Deck as
great with software compositing.

**How you'll be working.** You cannot reach the Deck. The owner runs
commands and pastes the output back, or sends a phone photo (HEIC; convert
it with `sips -s format jpeg <in> --out <out>.jpg` before reading it).

- In Desktop Mode there is **no keyboard**: Steam + X did not bring up the
  on-screen keyboard, so the in-game `C` (CRT) and `F` (FPS) toggles can't
  be pressed.
- Started from Konsole, the controller is keyboard/mouse emulation, and R2
  steals focus (finding 8).
- So every test toggle must be settable from the command line.
- The triangle shows in Desktop Mode (Wayland) under `./antivirus-95
  --use-angle=gl`. Whether it also shows on X11 was never checked; try
  `--ozone-platform=x11 --disable-gpu-compositing` alongside.

**Toggles to add first (none exist yet).** The page can't see the process's
arguments, so `electron/main.js` has to forward them. For example, read
`process.env.ANTIVIRUS95_DEBUG` and load `app://antivirus-95/?debug=<value>`;
`src/main.ts` then reads it with `new URLSearchParams(location.search)`.
Log the active toggles with `console.info` so `antivirus-95.log` records them.
Useful toggles:

| Toggle | Change | Side effect |
| --- | --- | --- |
| `nobackbuffer` | `useBackBuffer: false` in `app.init` (`src/main.ts`) | the menu's frosted header and panel (`BackdropBlurFilter` in `src/menu.ts`) stop working; fine for a test |
| `nocrt` | don't install the CRT on `app.stage` (`src/game.ts` constructor) | no curvature or scanlines |
| `nobloom` | `world.filters = []` | no glow |

Then, in Konsole: `ANTIVIRUS95_DEBUG=nobackbuffer ./antivirus-95 --use-angle=gl`,
start a game, and ask for a photo. Run one toggle per run.

**The suspects, with the Pixi code to read** (Pixi 8.21):

- **The back-buffer present.** `_presentBackBuffer()` in
  `node_modules/pixi.js/lib/rendering/renderers/gl/GlBackBufferSystem.mjs`
  draws `bigTriangleGeometry`, one triangle at NDC (-1,-1), (3,-1), (-1,3)
  that overshoots the screen. The missing region looks like that triangle
  with its (3,-1) corner landed higher. This is only a guess from the photo.
- **The CRT pass on `app.stage`.** It uses Pixi's filter quad:
  `quadGeometry` in `node_modules/pixi.js/lib/filters/FilterSystem.mjs`,
  with a `Uint32Array` index buffer `[0, 1, 2, 0, 2, 3]`. The shader is in
  `src/crt-filter.ts`, and it clamps its sampling and writes alpha 1.
- **Probably not the bloom on `world`.** The HUD, which sits outside
  `world`, was cut too.

`nobackbuffer` curing it points at the present pass. `nocrt` curing it
points at the CRT pass. If neither does, look at Chromium's compositor.

**Worth collecting from the Deck:** the Mesa and ANGLE versions. Log
`app.getGPUInfo('complete')` in place of `'basic'`; it carries the GL
strings. With a version and a minimal repro, it may be an upstream
Mesa/ANGLE bug to report rather than ours to fix.

**Before switching Linux back to OpenGL:**

- **OpenGL has never run in Gaming Mode.** v0.1.1, the only GL build that
  reached it, hung before starting (finding 1).
- **The launcher can't test GPU compositing today.** It always adds
  `--disable-gpu-compositing` in Gaming Mode, so give it an opt-out first,
  e.g. honour `ANTIVIRUS95_GPU_COMPOSITING=1`. Then test with
  `ANTIVIRUS95_GPU_COMPOSITING=1 ANTIVIRUS95_FLAGS="--use-angle=gl" %command%`.
- **If GL shows a picture in both modes with no triangle:**
  - remove the SteamOS Vulkan block in `electron/main.js`;
  - remove the compositing flag from the launcher;
  - compare the `[antivirus-95] fps` lines before and after;
  - update AGENTS.md and this file.

**Tooling.** The CDP helper scripts used on the Mac (key presses,
screenshots, a scripted gamepad) weren't committed. AGENTS.md describes the
approach; expect to rewrite them. A viewport override dies with its CDP
session, so run each check in one session.

## Playbook for the next Deck bug

1. **Get logs first.** Ask for `launch.log` and `antivirus-95.log`, plus
   `tail -40 chromium.log` or a `grep -iE "error|vulkan|swapchain|gpu"`,
   read **before** relaunching. Check the timestamps and the `exec` line.
2. **Try to reproduce Gaming Mode from Konsole in Desktop Mode.** Konsole
   gives immediate output and no restart when it hangs.
   - `--ozone-platform=x11` gets you gamescope's X11 conditions on KDE.
   - `SteamGameId=1 ./antivirus-95` makes the launcher take its Steam branch.
3. **Pass one change at a time,** through `./antivirus-95 --flag` in Konsole or
   `ANTIVIRUS95_FLAGS="--flag" %command%` in Steam.
4. **Confirm the renderer** (`renderer up: webgl`) before trusting a
   rendering result.
5. **If Gaming Mode wedges,** the way out is the power button → Restart.
   Returning to Desktop Mode can take a while as Steam waits for the process.

## Open questions

- The ANGLE-on-OpenGL triangle (finding 2): which pass, and why only on the
  Deck.
- Which of `--no-sandbox`, clearing `LD_PRELOAD` and clearing
  `LD_LIBRARY_PATH` actually cured the Gaming Mode hang (finding 1).
- Why arguments after `%command%` don't reach the launcher (finding 6).
- Deck frame rate with software compositing, measured rather than reported.

## Reference: the Deck in these sessions

- Steam Deck **LCD**. GPU vendor `0x1002` (AMD), device `0x163f` (5695): the
  Van Gogh ("Aerith") APU. The OLED model's APU ("Sephiroth") is a die
  shrink of the same design and has not been tested.
- Electron 44.4.5. Chromium reports `hardwareSupportsVulkan: false` in the
  early GPU info even when Vulkan works; ignore it.
- Gaming Mode also sets `vk_xwayland_wait_ready` (Mesa prints `ATTENTION:
  default value of option vk_xwayland_wait_ready overridden by environment`)
  and points Fossilize at Steam's shader cache. Neither caused a problem.
