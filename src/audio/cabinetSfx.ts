class CabinetSfxEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  constructor() {
    try {
      this.muted = window.localStorage.getItem("gabinete_vava_sfx_muted") === "1";
    } catch {
      this.muted = false;
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      window.localStorage.setItem("gabinete_vava_sfx_muted", muted ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === "suspended") {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** Batida dupla de martelo de madeira da Mesa Diretora */
  public playGavelStrike(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const hitAt = (offset: number, intensity: number) => {
      const t = ctx.currentTime + offset;

      // Corpo grave de madeira
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(165, t);
      osc.frequency.exponentialRampToValueAtTime(52, t + 0.14);
      gain.gain.setValueAtTime(0.45 * intensity, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);

      // Estalo seco de madeira (ruído filtrado)
      const noise = ctx.createBufferSource();
      noise.buffer = this.createNoiseBuffer(ctx, 0.09);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(620, t);
      filter.Q.setValueAtTime(2.6, t);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.5 * intensity, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
      noise.connect(filter).connect(nGain).connect(ctx.destination);
      noise.start(t);
    };

    hitAt(0, 1);
    hitAt(0.21, 0.85);
  }

  /** Carimbo de borracha pesado batendo em papel de ofício */
  public playStampThud(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(125, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.09);
    gain.gain.setValueAtTime(0.42, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);

    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.07);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, t);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.26, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    noise.connect(filter).connect(nGain).connect(ctx.destination);
    noise.start(t);
  }

  /** Estalo + corte abrupto de microfone de plenário */
  public playMicCut(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(920, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.16);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.19);

    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.14);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(1600, t);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.15, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    noise.connect(hp).connect(nGain).connect(ctx.destination);
    noise.start(t);
  }

  /** Telefone fixo analógico de gabinete tocando */
  public playOfficePhone(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const ringBurst = (startOffset: number, duration: number) => {
      const t = ctx.currentTime + startOffset;
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const master = ctx.createGain();

      oscA.type = "sine";
      oscB.type = "sine";
      oscA.frequency.setValueAtTime(440, t);
      oscB.frequency.setValueAtTime(480, t);

      lfo.type = "square";
      lfo.frequency.setValueAtTime(18, t);
      lfoGain.gain.setValueAtTime(0.07, t);

      master.gain.setValueAtTime(0.08, t);
      master.gain.setValueAtTime(0.08, t + duration - 0.03);
      master.gain.exponentialRampToValueAtTime(0.001, t + duration);

      lfo.connect(lfoGain).connect(master.gain);
      oscA.connect(master);
      oscB.connect(master);
      master.connect(ctx.destination);

      oscA.start(t);
      oscB.start(t);
      lfo.start(t);
      oscA.stop(t + duration);
      oscB.stop(t + duration);
      lfo.stop(t + duration);
    };

    ringBurst(0, 0.36);
    ringBurst(0.5, 0.36);
  }

  /** Bipe de interfone da Dona Neide */
  public playIntercomBeep(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const beep = (offset: number, freq: number, dur: number) => {
      const t = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.01);
    };

    beep(0, 740, 0.11);
    beep(0.15, 988, 0.16);
  }

  /** Vinheta curta de Plantão TV Câmara */
  public playTickerAlert(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const t = ctx.currentTime + idx * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.13, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.19);
    });
  }

  /** Pasta parda deslizando na mesa de jacarandá */
  public playDossierSlide(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.24);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(650, t + 0.22);
    filter.Q.setValueAtTime(1.4, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t);
  }
}

export const cabinetSfx = new CabinetSfxEngine();
