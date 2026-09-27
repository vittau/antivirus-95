/**
 * Procedural WebAudio synth — no audio files.
 *
 * Everything (SFX, the siren, the synthwave music loop) is generated from
 * oscillators at runtime, which keeps the bundle tiny and offline-friendly.
 * All entry points are safe to call before the AudioContext exists; audio
 * simply stays silent until `resume()` is called from a user gesture.
 *
 * The palette is "Antivirus 95": dry data ticks, floppy-drive clacks,
 * hard-drive whir and CRT power-downs — square/pulse blips, filtered noise
 * and short FM chirps. Nothing here is meant to sound like an arcade cab.
 */

/** A minor pentatonic, used as the pitch pool for the dry "data tick" blips. */
const TICK_NOTES = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  muted = false;
  private musicOn = false;
  private nextNoteTime = 0;
  private step = 0;
  private readonly stepDur = 0.125; // 16th notes @ 120 BPM

  /** One white-noise buffer per context; bursts are windows into it. */
  private noiseBuffer: AudioBuffer | null = null;
  /** A hard 5-step transfer curve for the bit-crushed "delete" crunch. */
  private crushCurve: Float32Array<ArrayBuffer> | null = null;

  // A minor i - VI - III - VII, low roots.
  private readonly progression = [55.0, 43.65, 65.41, 49.0];

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(ctx.destination);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.85;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.3;
      this.musicBus.connect(this.master);
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  resume(): void {
    if (!this.ensure() || !this.ctx) return;
    void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: OscillatorType;
      gain?: number;
      when?: number;
      slideTo?: number;
      bus?: GainNode | null;
      attack?: number;
    } = {},
  ): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.when ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
    }
    const peak = opts.gain ?? 0.2;
    const attack = opts.attack ?? 0.004;
    g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(opts.bus ?? this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  /**
   * One white-noise burst through a biquad, with a gain envelope. The noise
   * buffer is built once and looped, so repeated hits don't allocate audio
   * data — only the per-event nodes, which are disconnected when they end.
   */
  private noise(
    dur: number,
    opts: {
      gain?: number;
      when?: number;
      type?: BiquadFilterType;
      freq?: number;
      q?: number;
      slideTo?: number;
      attack?: number;
      bus?: GainNode | null;
    } = {},
  ): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const buf = this.ensureNoise();
    if (!buf) return;
    const t0 = ctx.currentTime + (opts.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? 'lowpass';
    // Seed the frequency at build time: scheduling the first value at `t0`
    // lets the filter run at its default until then, and the coefficient jump
    // lands as a click on a delayed burst.
    filter.frequency.value = Math.max(20, opts.freq ?? 1200);
    if (opts.slideTo) {
      filter.frequency.setValueAtTime(Math.max(20, opts.freq ?? 1200), t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur);
    }
    filter.Q.value = opts.q ?? 0.9;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.12;
    const attack = opts.attack ?? 0.003;
    g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(opts.bus ?? this.sfxBus);
    // A random window into the loop keeps repeated hits from sounding cloned.
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  /** Short FM chirp: a sine modulator bending the carrier's pitch. */
  private fm(
    carrier: number,
    dur: number,
    opts: {
      mod?: number;
      index?: number;
      type?: OscillatorType;
      gain?: number;
      when?: number;
      slideTo?: number;
      bus?: GainNode | null;
    } = {},
  ): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.when ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(Math.max(1, carrier), t0);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
    }
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(Math.max(1, opts.mod ?? carrier * 2), t0);
    const modGain = ctx.createGain();
    const index = opts.index ?? 400;
    modGain.gain.setValueAtTime(index, t0);
    modGain.gain.exponentialRampToValueAtTime(Math.max(1, index * 0.05), t0 + dur);
    mod.connect(modGain);
    modGain.connect(osc.frequency);
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.14;
    g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(opts.bus ?? this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    mod.start(t0);
    mod.stop(t0 + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    mod.onended = () => {
      mod.disconnect();
      modGain.disconnect();
    };
  }

  /**
   * Bit-crushed one-shot: a square drop and a noise smash pushed through a
   * hard quantiser. That stepping (not a clean sweep) is the "digital crunch".
   */
  private crush(
    freq: number,
    dur: number,
    opts: { gain?: number; when?: number; slideTo?: number; noiseGain?: number } = {},
  ): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.when ?? 0);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.crushCurveFor();
    shaper.oversample = 'none';
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.13;
    g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    shaper.connect(g);
    g.connect(this.sfxBus);

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo ?? freq * 0.35), t0 + dur);
    osc.connect(shaper);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);

    const buf = this.ensureNoise();
    let src: AudioBufferSourceNode | null = null;
    let nf: BiquadFilterNode | null = null;
    let ng: GainNode | null = null;
    if (buf) {
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      nf = ctx.createBiquadFilter();
      nf.type = 'lowpass';
      nf.frequency.setValueAtTime(4000, t0);
      nf.frequency.exponentialRampToValueAtTime(300, t0 + dur);
      ng = ctx.createGain();
      ng.gain.value = 0;
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.linearRampToValueAtTime(opts.noiseGain ?? 0.07, t0 + 0.004);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(nf);
      nf.connect(ng);
      ng.connect(shaper);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + dur + 0.02);
    }
    const dispose = (): void => {
      osc.disconnect();
      shaper.disconnect();
      g.disconnect();
      src?.disconnect();
      nf?.disconnect();
      ng?.disconnect();
    };
    osc.onended = dispose;
    if (src) src.onended = dispose;
  }

  /** A saw motor with an amplitude flutter; the fan spin rate rises with heat. */
  private motor(freq: number, dur: number, gain: number, when: number, intensity: number): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + intensity * 900;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(gain, t0);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(20 + intensity * 45, t0);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = gain * 0.35;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      lp.disconnect();
      g.disconnect();
    };
    lfo.onended = () => {
      lfo.disconnect();
      lfoGain.disconnect();
    };
  }

  private ensureNoise(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (this.noiseBuffer) return this.noiseBuffer;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  private crushCurveFor(): Float32Array<ArrayBuffer> {
    if (this.crushCurve) return this.crushCurve;
    const steps = 5;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    this.crushCurve = curve;
    return curve;
  }

  // --- SFX -----------------------------------------------------------------

  /**
   * A bit eaten: a dry data tick, pitch picked at random from a pentatonic
   * pool so no two consecutive bits sound the same (never two alternating
   * fixed pitches).
   */
  bitEaten(): void {
    const f = TICK_NOTES[(Math.random() * TICK_NOTES.length) | 0];
    this.tone(f, 0.032, { type: 'square', gain: 0.11 });
    this.tone(f * 2, 0.018, { type: 'square', gain: 0.04, when: 0.004 });
    this.noise(0.016, { gain: 0.035, type: 'highpass', freq: 5000 });
  }

  powerUp(): void {
    // The virus loads the exploit: the floppy seeks, then reads, then settles.
    for (let i = 0; i < 3; i++) {
      const at = i * 0.11;
      this.noise(0.035, { gain: 0.1, type: 'bandpass', freq: 2200, q: 1.4, slideTo: 900, when: at });
      this.tone(150, 0.05, { type: 'square', gain: 0.06, slideTo: 55, when: at });
    }
    for (let i = 0; i < 9; i++) {
      const f = TICK_NOTES[(Math.random() * TICK_NOTES.length) | 0];
      this.tone(f, 0.028, { type: 'square', gain: 0.05, when: 0.34 + i * 0.033 });
    }
    // Ominous tail: the exploit bedding in.
    this.tone(98, 0.5, { type: 'sawtooth', gain: 0.095, when: 0.6, slideTo: 49, attack: 0.06 });
    this.noise(0.5, { gain: 0.03, type: 'lowpass', freq: 500, slideTo: 120, when: 0.6, attack: 0.06 });
  }

  daemonDeleted(): void {
    // The virus deletes a daemon: bit-crushed crunch and a sharp drop.
    this.crush(900, 0.3, { gain: 0.13, slideTo: 80, noiseGain: 0.07 });
    this.crush(1400, 0.16, { gain: 0.06, slideTo: 140, when: 0.05, noiseGain: 0.04 });
    this.tone(1568, 0.1, { type: 'square', gain: 0.06, slideTo: 180, when: 0.02 });
  }

  fruit(): void {
    // A bonus BIT: a crisp two-tick "cache hit".
    this.tone(1046.5, 0.06, { type: 'square', gain: 0.11 });
    this.tone(1568, 0.1, { type: 'square', gain: 0.11, when: 0.07 });
    this.noise(0.02, { gain: 0.025, type: 'highpass', freq: 5000, when: 0.07 });
  }

  death(): void {
    // CRT power-down: the flyback squeal and discharge hiss collapse, then a
    // relay thunk. A continuous glissando, deliberately not a death spiral.
    this.tone(6000, 0.85, { type: 'sine', gain: 0.05, slideTo: 110, attack: 0.008 });
    this.tone(2800, 0.85, { type: 'sawtooth', gain: 0.045, slideTo: 55, attack: 0.008 });
    this.noise(0.85, { gain: 0.07, type: 'lowpass', freq: 5200, slideTo: 180, attack: 0.01 });
    this.tone(70, 0.4, { type: 'sine', gain: 0.11, slideTo: 36, when: 0.72 });
    this.noise(0.05, { gain: 0.07, type: 'lowpass', freq: 800, when: 0.72 });
  }

  virusQuarantined(): void {
    // A daemon quarantines the virus: bright rising chord + modem handshake.
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.tone(f, 0.12, { type: 'square', gain: 0.07, when: i * 0.05 }),
    );
    this.tone(1568, 0.18, { type: 'triangle', gain: 0.05, when: 0.15 });
    this.noise(0.12, { gain: 0.045, type: 'bandpass', freq: 1200, q: 1.2, slideTo: 3600, when: 0.24 });
    for (let i = 0; i < 7; i++) {
      const f = 700 + Math.random() * 2000;
      this.tone(f, 0.018, { type: 'square', gain: 0.04, when: 0.24 + i * 0.017 });
    }
  }

  ability(): void {
    // Ability fires: a charge-up whoosh into a rising FM chirp.
    this.noise(0.18, { gain: 0.06, type: 'bandpass', freq: 400, q: 1, slideTo: 3200, attack: 0.02 });
    this.fm(300, 0.24, { mod: 900, index: 500, type: 'square', gain: 0.1, slideTo: 1200 });
  }

  /** Your ability is charged again: a short, bright chime. */
  abilityReady(): void {
    this.tone(1318.5, 0.07, { type: 'square', gain: 0.1 });
    this.tone(1975.5, 0.14, { type: 'square', gain: 0.09, when: 0.06 });
    this.noise(0.02, { gain: 0.025, type: 'highpass', freq: 5000 });
  }

  /** HALT's FREEZE: the sharp two-note sting as the virus locks up. */
  alert(): void {
    this.tone(1200, 0.06, { type: 'square', gain: 0.11 });
    this.tone(1800, 0.2, { type: 'square', gain: 0.1, when: 0.06, slideTo: 1500 });
    this.noise(0.04, { gain: 0.04, type: 'highpass', freq: 3000 });
  }

  banished(): void {
    // The virus slips the quarantine: a disk-eject whoosh and error beeps.
    this.noise(0.22, { gain: 0.09, type: 'bandpass', freq: 2600, q: 0.8, slideTo: 300 });
    this.tone(220, 0.24, { type: 'square', gain: 0.09, slideTo: 110, when: 0.04 });
    this.tone(330, 0.24, { type: 'square', gain: 0.06, slideTo: 165, when: 0.04 });
    [392, 294].forEach((f, i) =>
      this.tone(f, 0.12, { type: 'square', gain: 0.08, when: 0.26 + i * 0.12, slideTo: f * 0.85 }),
    );
  }

  levelClear(): void {
    // "Disk verified": a bright ascending run over a soft ready-pad.
    [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093].forEach((f, i) =>
      this.tone(f, 0.14, { type: 'square', gain: 0.085, when: i * 0.09 }),
    );
    [261.63, 392, 523.25].forEach((f) => this.tone(f, 0.8, { type: 'triangle', gain: 0.03, attack: 0.1 }));
    this.noise(0.25, { gain: 0.025, type: 'highpass', freq: 6000 });
  }

  gameOver(): void {
    [349.23, 293.66, 220, 146.83].forEach((f, i) =>
      this.tone(f, 0.32, { type: 'sawtooth', gain: 0.09, when: i * 0.2, slideTo: f * 0.8 }),
    );
    // The machine cooling down.
    this.noise(0.5, { gain: 0.04, type: 'lowpass', freq: 900, slideTo: 120, when: 0.7 });
    this.tone(55, 0.55, { type: 'sine', gain: 0.09, when: 0.78, slideTo: 30 });
  }

  uiSelect(): void {
    this.tone(880, 0.045, { type: 'square', gain: 0.09 });
  }

  uiConfirm(): void {
    this.tone(880, 0.06, { type: 'square', gain: 0.1 });
    this.tone(1174.7, 0.11, { type: 'square', gain: 0.1, when: 0.06 });
  }

  ready(): void {
    // A POST beep trio, with a tiny click from the speaker relay.
    [440, 659.25, 880].forEach((f, i) => {
      this.tone(f, 0.15, { type: 'square', gain: 0.1, when: i * 0.14 });
      this.noise(0.012, { gain: 0.03, type: 'highpass', freq: 4000, when: i * 0.14 });
    });
  }

  /**
   * A fan / hard-drive whir. Both the motor pitch and the flutter rate rise
   * with `intensity` 0..1 — it never wails up and down.
   */
  siren(intensity: number): void {
    const k = Math.max(0, Math.min(1, intensity));
    const hum = 55 + k * 75;
    this.motor(hum, 0.42, 0.032, 0, k);
    this.motor(hum * 1.008, 0.42, 0.024, 0, k);
    this.noise(0.42, { gain: 0.016 + k * 0.016, type: 'bandpass', freq: 700 + k * 900, q: 0.7, attack: 0.04 });
    this.tone(hum * 6, 0.42, { type: 'sine', gain: 0.012 + k * 0.012, attack: 0.05 });
  }

  // --- Music ---------------------------------------------------------------

  startMusic(): void {
    if (!this.ensure() || !this.ctx) return;
    if (this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
  }

  stopMusic(): void {
    this.musicOn = false;
  }

  /** Call every frame; schedules a lookahead window of the loop. */
  updateMusic(): void {
    if (!this.musicOn || !this.ctx || !this.musicBus || this.muted) return;
    const ctx = this.ctx;
    while (this.nextNoteTime < ctx.currentTime + 0.2) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += this.stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private scheduleStep(step: number, time: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const bar = (step / 16) | 0;
    const s = step % 16;
    const root = this.progression[bar];

    // Kick.
    if (s % 4 === 0) this.kick(time, root);
    // Hat.
    if (s % 2 === 1) this.tone(7000, 0.025, { type: 'square', gain: 0.028, when: time - ctx.currentTime, bus: this.musicBus });

    // Syncopated bass.
    const bassPattern: Record<number, number> = { 0: 1, 3: 1, 6: 1, 8: 1, 11: 2, 14: 1.5 };
    const mult = bassPattern[s];
    if (mult) {
      this.tone(root * mult, 0.22, {
        type: 'sawtooth',
        gain: 0.13,
        when: time - ctx.currentTime,
        bus: this.musicBus,
      });
    }

    // Pad chord at the top of each bar.
    if (s === 0) {
      const third = root * 1.2;
      const fifth = root * 1.5;
      const octave = root * 2;
      for (const f of [root * 2, third * 2, fifth * 2, octave * 2]) {
        this.tone(f, 2.0, {
          type: 'triangle',
          gain: 0.035,
          when: time - ctx.currentTime,
          bus: this.musicBus,
          attack: 0.35,
        });
      }
    }
  }

  private kick(time: number, root: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    const when = time - ctx.currentTime;
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.14);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.5, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.24);
    void when;
    void root;
  }
}
