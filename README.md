<p align="center">
  <img src="docs/readme/banner.svg" alt="Antivirus 95 — you are the daemon" width="100%">
</p>

<p align="center">
  <a href="https://www.vitormach.dev/antivirus-95/"><img src="https://img.shields.io/badge/play-in%20your%20browser-ff3fb0?style=for-the-badge&labelColor=1a0b34" alt="Play in your browser"></a>
  <a href="https://github.com/vittau/antivirus-95/releases/latest"><img src="https://img.shields.io/github/v/release/vittau/antivirus-95?style=for-the-badge&label=download&color=00e5ff&labelColor=1a0b34" alt="Download"></a>
  <a href="https://github.com/sponsors/vittau"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white&labelColor=1a0b34" alt="Sponsor"></a>
</p>

<p align="center">
  An arcade game where the tables are turned: <b>you are the daemon</b>.<br>
  Lead a squad of four antivirus daemons through a neon vaporwave maze and
  corner an AI virus that eats bits, grabs infected disks and, once it's
  powered up, <b>hunts you</b>.
</p>

<p align="center">
  <img src="docs/gameplay.jpg" alt="The virus gets an exploit and turns on the daemons" width="100%">
</p>

## <img src="docs/readme/h-play.svg" alt="Play" width="100%">

**In the browser:** [vitormach.dev/antivirus-95](https://www.vitormach.dev/antivirus-95/).
Nothing to install; a keyboard or a controller both work.

**On your machine:** grab the latest build from
[Releases](https://github.com/vittau/antivirus-95/releases/latest).

| System | File |
| --- | --- |
| Steam Deck / Linux | `Antivirus-95-…-linux-x64.tar.xz` |
| Windows | `Antivirus-95-…-windows-x64-setup.exe` (installer) or `…-portable.exe` |
| macOS (Apple Silicon) | `Antivirus-95-…-macos-arm64.dmg` |
| macOS (Intel) | `Antivirus-95-…-macos-x64.dmg` |

The desktop builds start in fullscreen with sound on. **F11** or
**Alt+Enter** toggles fullscreen, and **QUIT GAME** is on the pause screen.

> [!NOTE]
> The builds aren't signed with a paid certificate, so the OS asks once
> before the first launch.
>
> - **macOS** says it can't verify the app. Open **System Settings →
>   Privacy & Security**, scroll to the Antivirus 95 notice and click **Open
>   Anyway**. From a terminal:
>   `xattr -dr com.apple.quarantine "/Applications/Antivirus 95.app"`
> - **Windows** SmartScreen shows "Windows protected your PC". Click
>   **More info → Run anyway**.

## <img src="docs/readme/h-steam-deck.svg" alt="Steam Deck" width="100%">

The game is laid out for the Deck's 1280×800 screen and reads the controller
directly, with no Steam Input template needed.

1. Switch to **Desktop Mode** (Steam button → Power → Switch to Desktop).
2. Download the `.tar.xz` from
   [Releases](https://github.com/vittau/antivirus-95/releases/latest), then
   right-click it → **Extract → Extract archive here**. You get an
   `Antivirus-95` folder; move it wherever you keep games.
3. Inside it, right-click **`antivirus-95`** → **Add to Steam**. (Or, in Steam:
   *Games → Add a Non-Steam Game to My Library…* and browse to that file.)
4. Head back to **Gaming Mode**. Antivirus 95 is in your library under
   *Non-Steam*.

To update, extract the new version over the same folder: the Steam
shortcut keeps working.

If the buttons act like a keyboard, open the game's controller settings and
pick the **Gamepad** layout. To leave, use **QUIT GAME** on the pause screen
or the Steam button → *Exit game*.

If it won't start, each launch writes `launch.log`, `antivirus-95.log` and
`chromium.log` to `~/.config/Antivirus 95/`. Attach them to an
[issue](https://github.com/vittau/antivirus-95/issues).

## <img src="docs/readme/h-controls.svg" alt="Controls" width="100%">

The on-screen hints follow whichever device you touched last.

| Action | Keyboard | Controller |
| --- | --- | --- |
| Move | Arrows / WASD | D-pad / left stick |
| Start | Space / Enter | A |
| Squad stance | `1`–`4`, `Q` / `E` to cycle | L1 / R1 |
| Signature ability | Space | A / R2 |
| Pause | `P` / Esc | Menu ☰ |
| Next song | `M` | Y |
| Mute | `N` | View ⧉ |
| CRT effect / FPS readout | `C` / `F` | — |

<p align="center">
  <img src="docs/title-screen.jpg" alt="Title screen: pick your daemon" width="100%">
</p>

## <img src="docs/readme/h-squad.svg" alt="The squad" width="100%">

Pick your daemon on the title screen. The other three follow your orders.

| Daemon | Ability |
| --- | --- |
| **VOLT** | *Overclock*: a burst of raw speed |
| **RELAY** | *Hyperlink*: jump straight to the end of the corridor ahead |
| **NULL** | *Bypass*: slip through one wall |
| **HALT** | *Freeze*: the virus loses its bearings and wanders frozen for 2.5 s |

| Stance | What your teammates do |
| --- | --- |
| **TRACE** | Direct trace |
| **INTERCEPT** | Cut it off ahead |
| **ISOLATE** | Close its route |
| **FIREWALL** | Guard the disks, all but one; spare daemons trace |

## <img src="docs/readme/h-rules.svg" alt="Rules" width="100%">

- Quarantine the virus **three times** to clear a level. Each level brings a
  new maze, and they start over after the last.
- If the virus eats every bit, it's **game over** on the spot (infected disks
  don't count: an eaten one comes back 30 s later, its spot blinking for the
  last 5).
- An infected disk turns the tables: the virus gets an exploit and hunts, and
  it goes for *you* first. Your ability is locked until you recover.
- Get deleted and you lose a life, and your daemon respawns in the
  quarantine. You earn a life back for each level you clear, up to three.

## <img src="docs/readme/h-build.svg" alt="Build it" width="100%">

PixiJS 8 + Vite + TypeScript, with Electron for the desktop builds. Needs
**Node 24** (see `.nvmrc`).

```bash
npm install
npm run dev        # dev server at http://localhost:5173/ (or just `make`)
```

`npm run dev` prints the URL but does not open a browser tab itself.

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm start` | Vite dev server with hot reload |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run build` | Type-check + production web build into `dist/` |
| `npm run preview` | Serve the production build on :4173 |
| `npm run desktop` | Build, then run the game in the Electron shell |
| `npm run dist` | Package the desktop app for this OS into `release/` |
| `make deploy` | Publish the web build to GitHub Pages |

**Releases** are built by CI. Bump the version and push the tag;
[`release.yml`](.github/workflows/release.yml) builds Linux, Windows and
macOS in parallel and publishes them, with checksums, as a GitHub release:

```bash
npm version 0.2.0 && git push --follow-tags
```

Everything on screen is drawn from code: no sprite sheets, no image
assets. See [`AGENTS.md`](AGENTS.md) for the architecture and the rules
that keep the game working.

```
src/          the game (Pixi app, simulation, AI, rendering, audio, input)
electron/     desktop shell: window, app:// file server, quit bridge
docs/readme/  this README's art (node docs/readme/generate.mjs)
```

## <img src="docs/readme/h-credits.svg" alt="Credits" width="100%">

- **Music:** *Falling Organ*, *Tyranny of the Sun*, *Work in Progress*,
  *Demons on the Beach*, *Solitude* and *The Climax* by **vandalorum**
  (Primal Light Music), from
  [Space / Fast Synth / Epic Themes](https://opengameart.org/content/space-fast-synth-epic-themes)
  on OpenGameArt, licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Font:** *Press Start 2P* by CodeMan38, SIL Open Font License.

## <img src="docs/readme/h-support.svg" alt="Support" width="100%">

Antivirus 95 is free and always will be. If it gave you a good chase, you
can keep the daemons stocked with infected disks:

<p align="center">
  <a href="https://github.com/sponsors/vittau"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white&labelColor=1a0b34" alt="Sponsor"></a>
</p>
