import { Container, Graphics, Text } from 'pixi.js';
import {
  FONT_FAMILY,
  HUD_W,
  MAX_LIVES,
  VIRUS_LIVES,
  PALETTE,
  SCREEN_H,
  SCREEN_W,
  STANCE_INFO,
  STANCE_ORDER,
  VIEW_W,
} from './config';
import { drawDaemon, drawVirus } from './draw';
import { lerpColor } from './color';
import type { InputDevice } from './input';
import type { DaemonId, Stance } from './types';

export interface HudState {
  score: number;
  high: number;
  level: number;
  lives: number;
  virusLives: number;
  stance: Stance;
  abilityName: string;
  abilityReady: boolean;
  abilityLocked: boolean;
  abilityCd: number;
  abilityMax: number;
  playerColor: number;
  playerDark: number;
  playerId: DaemonId;
  playerName: string;
  playerAbility: string;
  playerAbilityDesc: string;
  frightTimer: number;
  frightMax: number;
  message: string;
  submessage: string;
  messageColor: number;
  /** Pause menu entries (empty when there is no menu), and the highlighted one. */
  pauseItems: readonly string[];
  pauseSelect: number;
  device: InputDevice;
  muted: boolean;
  trackName: string;
  showFps: boolean;
  fps: number;
}

// Vertical positions are fixed (canvas height never changes); layout()
// recomputes the horizontal ones so the panel tracks the window width.
// Sized for a 7" 1280x800 handheld: nothing smaller than 10px.
const STANCE_ROW_Y = [138, 178, 218, 258];
const DAEMON_BOX_Y = 376;
const DAEMON_BOX_H = 118;
const ABILITY_BAR_Y = 344;
const ABILITY_GLOW_MS = 900;
const LIVES_Y = 512;
const PAUSE_ITEM_Y = 392;
const PAUSE_ITEM_GAP = 30;

/** Panel hints, worded for the device in use. */
const HINTS: Record<InputDevice, { ability: string; line1: string; line2: string }> = {
  keyboard: { ability: 'SPACE', line1: '1-4 STANCE  P PAUSE', line2: 'M MUSIC  C CRT' },
  gamepad: { ability: 'A', line1: 'L1/R1 STANCE  MENU PAUSE', line2: 'Y MUSIC  VIEW MUTE' },
};

const mkText = (
  text: string,
  size: number,
  fill: number,
  align: 'left' | 'center' | 'right' = 'left',
): Text => {
  const t = new Text({ text, style: { fontFamily: FONT_FAMILY, fontSize: size, fill, align } });
  t.anchor.set(align === 'left' ? 0 : align === 'center' ? 0.5 : 1, 0);
  return t;
};

/**
 * Right-hand arcade panel. Deliberately contains no board information — no
 * minimap — so the game has to be read from the maze itself.
 */
export class Hud {
  readonly layer = new Container();
  /** The FPS readout lives apart from the panel so it also shows on the title screen. */
  readonly fpsLayer = new Container();
  private readonly fpsBack = new Graphics();

  private readonly panel = new Graphics();
  private readonly bars = new Graphics();
  private readonly dividers = new Graphics();
  private readonly daemonBox = new Graphics();
  private readonly bigDaemon = new Graphics();
  private readonly lifeLayer = new Container();
  private readonly lifeIcons: Graphics[] = [];
  private readonly virusIcons: Graphics[] = [];

  private readonly scoreLabel = mkText('SCORE', 10, PALETTE.textDim);
  private readonly scoreValue = mkText('000000', 24, PALETTE.text);
  private readonly highLabel = mkText('HIGH', 10, PALETTE.textDim);
  private readonly highValue = mkText('000000', 13, PALETTE.accent);
  private readonly levelLabel = mkText('LEVEL', 10, PALETTE.textDim);
  private readonly levelValue = mkText('1', 13, PALETTE.accent2);
  private readonly squadTitle = mkText('SQUAD ORDERS', 11, PALETTE.accent2);
  private readonly stanceNames: Text[] = [];
  private readonly stanceDescs: Text[] = [];
  private readonly barsKeyLabels: Text[] = [];
  private readonly abilityLabel = mkText('ABILITY [SPACE]', 10, PALETTE.textDim);
  private readonly abilityValue = mkText('', 13, PALETTE.gold);
  private readonly yourDaemonLabel = mkText('YOUR DAEMON', 11, PALETTE.accent2);
  private readonly playerNameText = mkText('', 15, PALETTE.text);
  private readonly playerAbilityText = mkText('', 11, PALETTE.text);
  private readonly playerAbilityDesc = mkText('', 10, PALETTE.textDim);
  private readonly livesLabel = mkText('LIVES', 10, PALETTE.textDim);
  private readonly virusLivesLabel = mkText('QUARANTINES', 10, PALETTE.textDim);
  private readonly keyHint1 = mkText('1-4 STANCE  P PAUSE', 10, PALETTE.textDim);
  private readonly keyHint2 = mkText('M MUSIC  C CRT', 10, PALETTE.textDim);
  private readonly trackText = mkText('', 10, PALETTE.textDim);
  private readonly fpsText = mkText('', 11, PALETTE.accent2);

  private readonly message = mkText('', 34, PALETTE.gold, 'center');
  private readonly submessage = mkText('', 14, PALETTE.text, 'center');
  private readonly pauseItems = [0, 1].map(() => mkText('', 14, PALETTE.text, 'center'));
  /** Backing card for the pause menu, so its entries read over the maze. */
  private readonly pauseBack = new Graphics();
  private readonly frightBar = new Graphics();

  private panelX = 0;
  /** What the daemon card and the life icons were last drawn for ('' = redraw). */
  private cardKey = '';
  private livesKey = '';
  private abilityGlowAt = -Infinity;
  private cx = 0;
  private cw = 0;

  constructor() {
    this.layer.eventMode = 'none';

    STANCE_ROW_Y.forEach(() => {
      this.stanceNames.push(mkText('', 12, PALETTE.text));
      this.stanceDescs.push(mkText('', 10, PALETTE.textDim));
    });
    for (let i = 0; i < STANCE_ORDER.length; i++) {
      const t = mkText(STANCE_INFO[STANCE_ORDER[i]].key, 11, PALETTE.white, 'center');
      t.anchor.set(0.5, 0.5);
      this.barsKeyLabels.push(t);
    }

    for (let i = 0; i < MAX_LIVES; i++) {
      const v = new Graphics();
      this.lifeIcons.push(v);
      this.lifeLayer.addChild(v);
    }
    for (let i = 0; i < VIRUS_LIVES; i++) {
      const v = new Graphics();
      this.virusIcons.push(v);
      this.lifeLayer.addChild(v);
    }

    this.layer.addChild(
      this.panel,
      this.dividers,
      this.daemonBox,
      this.bigDaemon,
      this.bars,
      this.frightBar,
      this.scoreLabel,
      this.scoreValue,
      this.highLabel,
      this.highValue,
      this.levelLabel,
      this.levelValue,
      this.squadTitle,
      this.abilityLabel,
      this.abilityValue,
      this.yourDaemonLabel,
      this.playerNameText,
      this.playerAbilityText,
      this.playerAbilityDesc,
      this.livesLabel,
      this.virusLivesLabel,
      this.keyHint1,
      this.keyHint2,
      this.trackText,
      this.lifeLayer,
      this.pauseBack,
      this.message,
      this.submessage,
      ...this.pauseItems,
      ...this.stanceNames,
      ...this.stanceDescs,
      ...this.barsKeyLabels,
    );

    this.fpsBack.roundRect(10, 6, 84, 20, 4).fill({ color: PALETTE.bgDeep, alpha: 0.82 });
    this.fpsBack.roundRect(10, 6, 84, 20, 4).stroke({ width: 1, color: PALETTE.accent2, alpha: 0.4 });
    this.fpsLayer.addChild(this.fpsBack, this.fpsText);
    this.fpsLayer.visible = false;

    this.layout();
  }

  /** Recompute every width-dependent position. Safe to call on resize. */
  layout(): void {
    this.panelX = SCREEN_W - HUD_W;
    this.cx = this.panelX + 24;
    this.cw = HUD_W - 48;

    this.panel.clear();
    this.panel.rect(this.panelX, 0, HUD_W, SCREEN_H).fill({ color: PALETTE.bgDeep, alpha: 0.5 });
    // Neon seam between the maze and the panel, pink at the top to cyan below.
    for (let i = 0; i < 24; i++) {
      const t = i / 23;
      const col = lerpColor(PALETTE.wallTop, PALETTE.wallBot, t);
      const y = (i * SCREEN_H) / 24;
      this.panel.rect(this.panelX, y, 2, SCREEN_H / 24 + 1).fill({ color: col, alpha: 0.75 });
      this.panel.rect(this.panelX + 2, y, 6, SCREEN_H / 24 + 1).fill({ color: col, alpha: 0.08 });
    }

    this.dividers.clear();
    for (const y of [104, 364, 502, 584]) {
      this.dividers.rect(this.panelX + 20, y, HUD_W - 40, 1).fill({ color: PALETTE.accent, alpha: 0.2 });
    }

    const x = this.cx;
    const col2 = x + Math.round(this.cw * 0.52);
    this.scoreLabel.position.set(x, 18);
    this.scoreValue.position.set(x, 34);
    this.highLabel.position.set(x, 68);
    this.highValue.position.set(x, 83);
    this.levelLabel.position.set(col2, 68);
    this.levelValue.position.set(col2, 83);
    this.squadTitle.position.set(x, 116);

    STANCE_ROW_Y.forEach((y, i) => {
      this.stanceNames[i].position.set(x + 34, y + 1);
      this.stanceDescs[i].position.set(x + 34, y + 18);
      this.barsKeyLabels[i].position.set(x + 11, y + 13);
    });

    this.abilityLabel.position.set(x, ABILITY_BAR_Y - 40);
    this.abilityValue.position.set(x, ABILITY_BAR_Y - 22);

    this.yourDaemonLabel.visible = false;
    this.bigDaemon.position.set(x + 40, DAEMON_BOX_Y + 60);
    this.playerNameText.position.set(x + 84, DAEMON_BOX_Y + 16);
    this.playerAbilityText.position.set(x + 84, DAEMON_BOX_Y + 42);
    this.playerAbilityDesc.position.set(x + 84, DAEMON_BOX_Y + 62);
    this.playerAbilityDesc.style.wordWrap = true;
    this.playerAbilityDesc.style.lineHeight = 15;
    this.playerAbilityDesc.style.wordWrapWidth = this.cw - 86;

    this.livesLabel.position.set(x, LIVES_Y);
    this.virusLivesLabel.position.set(col2, LIVES_Y);
    this.keyHint1.position.set(x, 598);
    this.keyHint2.position.set(x, 618);
    this.trackText.position.set(x, 648);
    this.fpsText.position.set(18, 12);

    this.message.position.set(VIEW_W / 2, 330);
    this.submessage.position.set(VIEW_W / 2, 378);
    this.pauseItems.forEach((t, i) => t.position.set(VIEW_W / 2, PAUSE_ITEM_Y + i * PAUSE_ITEM_GAP));
    const cardW = 380;
    const cardTop = 300;
    const cardBottom = PAUSE_ITEM_Y + this.pauseItems.length * PAUSE_ITEM_GAP + 16;
    this.pauseBack.clear();
    this.pauseBack
      .roundRect(VIEW_W / 2 - cardW / 2, cardTop, cardW, cardBottom - cardTop, 12)
      .fill({ color: PALETTE.bgDeep, alpha: 0.88 })
      .stroke({ width: 1.5, color: PALETTE.accent2, alpha: 0.55 });
    this.cardKey = '';
    this.livesKey = '';
  }

  /** Light up the ability meter: it just became usable again. */
  flashAbility(): void {
    this.abilityGlowAt = performance.now();
  }

  /** 1 → 0 over the ready flash. */
  private abilityGlow(): number {
    return Math.max(0, 1 - (performance.now() - this.abilityGlowAt) / ABILITY_GLOW_MS);
  }

  update(s: HudState): void {
    this.fpsLayer.visible = s.showFps;
    this.fpsText.text = `${Math.round(s.fps)} FPS`;
    // Hidden on the title screen: nothing else to draw.
    if (!this.layer.visible) return;

    this.scoreValue.text = String(s.score).padStart(6, '0');
    this.highValue.text = String(s.high).padStart(6, '0');
    this.levelValue.text = String(s.level);
    this.abilityValue.text = s.abilityName;
    this.abilityValue.style.fill = s.abilityReady ? PALETTE.gold : PALETTE.textDim;
    this.abilityValue.scale.set(1 + 0.18 * this.abilityGlow());
    const hints = HINTS[s.device];
    this.abilityLabel.text = s.abilityLocked ? 'ABILITY LOCKED' : `ABILITY [${hints.ability}]`;
    this.keyHint1.text = hints.line1;
    this.keyHint2.text = hints.line2;
    this.abilityLabel.style.fill = s.abilityLocked ? PALETTE.danger : PALETTE.textDim;
    // Already formatted (and ♪-prefixed) by Game.audioHintText().
    this.trackText.text = s.trackName;

    this.playerNameText.text = s.playerName;
    this.playerNameText.style.fill = s.playerColor;
    this.playerAbilityText.text = s.playerAbility;
    this.playerAbilityDesc.text = s.playerAbilityDesc;

    this.message.text = s.message;
    this.message.style.fill = s.messageColor;
    this.submessage.text = s.submessage;
    this.pauseBack.visible = s.pauseItems.length > 0;
    this.pauseItems.forEach((t, i) => {
      const item = s.pauseItems[i];
      const active = i === s.pauseSelect;
      t.text = item ? (active ? `> ${item} <` : item) : '';
      t.style.fill = active ? PALETTE.gold : PALETTE.textDim;
    });

    this.drawStances(s);
    this.drawMeters(s);
    this.drawDaemonCard(s);
    this.drawLives(s);
    this.drawFright(s);
  }

  private drawStances(s: HudState): void {
    this.bars.clear();
    STANCE_ORDER.forEach((st, i) => {
      const y = STANCE_ROW_Y[i];
      const active = st === s.stance;
      const info = STANCE_INFO[st];
      this.stanceNames[i].text = info.name;
      this.stanceDescs[i].text = info.desc;
      this.stanceNames[i].style.fill = active ? PALETTE.accent2 : PALETTE.text;
      this.stanceDescs[i].style.fill = active ? PALETTE.text : PALETTE.textDim;

      if (active) {
        this.bars.roundRect(this.cx - 6, y - 5, this.cw + 8, 36, 5).fill({ color: PALETTE.accent, alpha: 0.16 });
        this.bars.roundRect(this.cx - 6, y - 5, 3, 36, 1.5).fill({ color: PALETTE.accent2 });
      }
      this.bars.roundRect(this.cx, y + 2, 22, 22, 4).fill({
        color: active ? PALETTE.accent : PALETTE.wallFill,
        alpha: active ? 0.9 : 0.55,
      });
      this.bars.roundRect(this.cx, y + 2, 22, 22, 4).stroke({
        width: 1,
        color: active ? PALETTE.accent2 : PALETTE.wallDim,
        alpha: active ? 1 : 0.6,
      });
      this.barsKeyLabels[i].style.fill = active ? PALETTE.white : PALETTE.textDim;
    });
  }

  private drawMeters(s: HudState): void {
    if (s.abilityLocked) {
      this.ledBar(ABILITY_BAR_Y, 1, PALETTE.danger, 0.3);
    } else {
      const glow = this.abilityGlow();
      const color = lerpColor(PALETTE.gold, PALETTE.white, glow * 0.6);
      this.ledBar(ABILITY_BAR_Y, s.abilityReady ? 1 : 1 - s.abilityCd / s.abilityMax, color);
      if (glow > 0) {
        // Ready flash: a halo that expands and fades, and a bright sweep
        // running across the segments.
        const y = ABILITY_BAR_Y;
        const pad = 3 + (1 - glow) * 7;
        this.bars.roundRect(this.cx - 3, y - 3, this.cw + 6, 16, 4).fill({ color: PALETTE.gold, alpha: 0.28 * glow });
        this.bars
          .roundRect(this.cx - pad, y - pad, this.cw + pad * 2, 10 + pad * 2, 5)
          .stroke({ width: 2, color: PALETTE.gold, alpha: glow });
        const sx = this.cx + this.cw * Math.min(1, (1 - glow) * 1.5);
        this.bars.rect(Math.min(sx, this.cx + this.cw - 18), y - 2, 18, 14).fill({ color: PALETTE.white, alpha: 0.65 * glow });
      }
    }
  }

  /** Segmented LED meter; the leading segment glows while it charges. */
  private ledBar(y: number, frac: number, color: number, alpha = 1): void {
    const n = 16;
    const gap = 3;
    const w = (this.cw - gap * (n - 1)) / n;
    const lit = Math.max(0, Math.min(1, frac)) * n;
    for (let i = 0; i < n; i++) {
      const x = this.cx + i * (w + gap);
      const k = Math.max(0, Math.min(1, lit - i));
      this.bars.rect(x, y, w, 10).fill({ color: PALETTE.wallFill, alpha: 0.85 });
      if (k > 0) {
        this.bars.rect(x, y, w, 10).fill({ color, alpha: alpha * (k < 1 ? 0.35 + 0.5 * k : 1) });
        this.bars.rect(x, y, w, 3).fill({ color: PALETTE.white, alpha: alpha * 0.25 * k });
      }
    }
  }

  /** Decorative identity card: who you are, not where anything is. */
  private drawDaemonCard(s: HudState): void {
    // The daemon is drawn once per colour and pulses by scale; its geometry is
    // all proportional to the radius, so that matches a redraw at 30 * pulse.
    const pulse = 1 + Math.sin(Date.now() / 260) * 0.04;
    this.bigDaemon.scale.set(pulse);
    const key = `${s.playerColor}`;
    if (key === this.cardKey) return;
    this.cardKey = key;

    const x = this.panelX + 20;
    const w = HUD_W - 40;

    this.daemonBox.clear();
    this.daemonBox.roundRect(x, DAEMON_BOX_Y, w, DAEMON_BOX_H, 8).fill({ color: 0x120a26, alpha: 0.55 });
    this.daemonBox.roundRect(x, DAEMON_BOX_Y, w, DAEMON_BOX_H, 8).stroke({
      width: 1,
      color: s.playerColor,
      alpha: 0.7,
    });

    this.bigDaemon.clear();
    // The card shows the daemon's neutral face, drawn once per selection.
    drawDaemon(this.bigDaemon, 30, {
      color: s.playerColor,
      colorDark: s.playerDark,
      id: s.playerId,
      dir: 'right',
    });
  }

  private drawLives(s: HudState): void {
    const key = `${s.lives},${s.virusLives},${s.playerColor}`;
    if (key === this.livesKey) return;
    this.livesKey = key;
    this.lifeIcons.forEach((v, i) => {
      const on = i < s.lives;
      v.visible = on;
      if (!on) return;
      v.clear();
      v.position.set(this.cx + 13 + i * 28, LIVES_Y + 40);
      drawDaemon(v, 12, {
        color: s.playerColor,
        colorDark: s.playerDark,
        id: s.playerId,
        dir: 'left',
      });
    });

    this.virusIcons.forEach((v, i) => {
      const on = i < s.virusLives;
      v.visible = on;
      if (!on) return;
      v.clear();
      v.position.set(this.cx + Math.round(this.cw * 0.52) + 12 + i * 28, LIVES_Y + 40);
      drawVirus(v, 11, { mouth: 0.6, dir: 'right' });
    });
  }

  private drawFright(s: HudState): void {
    this.frightBar.clear();
    if (s.frightTimer <= 0) return;
    const w = VIEW_W - 80;
    const frac = s.frightTimer / s.frightMax;
    this.frightBar.roundRect(40, 14, w, 6, 3).fill({ color: PALETTE.wallFill, alpha: 0.6 });
    this.frightBar.roundRect(40, 14, w * frac, 6, 3).fill({ color: PALETTE.danger, alpha: 0.95 });
  }
}
