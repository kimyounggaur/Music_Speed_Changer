import SignalsmithStretch, { type StretchNode, type StretchSchedule } from 'signalsmith-stretch';
import type { DspState, LoopState } from '../types';
import { cloneAudioBuffer, clamp, dbToGain, getEffectivePitch, getEffectiveTempo } from './utils';

type TimeCallback = (positionSec: number, durationSec: number) => void;
type EndCallback = () => void;

interface GraphNodes {
  preamp: GainNode;
  panner: StereoPannerNode;
  eq: BiquadFilterNode[];
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
  effectsInput: GainNode;
  dry: GainNode;
  echoDelay: DelayNode;
  echoFeedback: GainNode;
  echoWet: GainNode;
  flangerDelay: DelayNode;
  flangerWet: GainNode;
  flangerLfo: OscillatorNode;
  flangerDepth: GainNode;
  reverb: ConvolverNode;
  reverbWet: GainNode;
  effectsOutput: GainNode;
  mono: GainNode;
  analyser: AnalyserNode;
  streamDestination: MediaStreamAudioDestinationNode;
}

export class TempoAudioEngine {
  private context?: AudioContext;
  private nodes?: GraphNodes;
  private hiddenAudio?: HTMLAudioElement;
  private stretch?: StretchNode;
  private fallbackSource?: AudioBufferSourceNode;
  private baseBuffer?: AudioBuffer;
  private activeBuffer?: AudioBuffer;
  private channelCount = 2;
  private positionSec = 0;
  private durationSec = 0;
  private sourceStartedAt = 0;
  private sourceStartPosition = 0;
  private playing = false;
  private reverse = false;
  private dsp?: DspState;
  private loop?: LoopState;
  private rafId?: number;
  private onTime?: TimeCallback;
  private onEnded?: EndCallback;
  private reverbSeconds = 0;
  private usingStretch = false;

  setCallbacks(onTime: TimeCallback, onEnded: EndCallback): void {
    this.onTime = onTime;
    this.onEnded = onEnded;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get duration(): number {
    return this.durationSec;
  }

  get position(): number {
    return this.positionSec;
  }

  get usesSignalsmith(): boolean {
    return this.usingStretch;
  }

  async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.setupGraph(this.context);
    }
    return this.context;
  }

  async resume(): Promise<void> {
    const context = await this.ensureContext();
    if (context.state !== 'running') await context.resume();
    if (this.hiddenAudio) {
      try {
        await this.hiddenAudio.play();
      } catch {
        // Browsers can reject until a user gesture; play() is retried from transport actions.
      }
    }
  }

  async decodeBlob(blob: Blob): Promise<AudioBuffer> {
    const context = await this.ensureContext();
    const arrayBuffer = await blob.arrayBuffer();
    return context.decodeAudioData(arrayBuffer.slice(0));
  }

  async loadBlob(blob: Blob, dsp: DspState, loop: LoopState, reverse = false): Promise<AudioBuffer> {
    await this.stop(false);
    const decoded = await this.decodeBlob(blob);
    return this.loadBuffer(decoded, dsp, loop, reverse);
  }

  async loadBuffer(buffer: AudioBuffer, dsp: DspState, loop: LoopState, reverse = false): Promise<AudioBuffer> {
    const context = await this.ensureContext();
    this.baseBuffer = buffer;
    this.reverse = reverse;
    this.activeBuffer = cloneAudioBuffer(context, buffer, reverse);
    this.durationSec = this.activeBuffer.duration;
    this.positionSec = 0;
    this.channelCount = Math.max(1, Math.min(2, this.activeBuffer.numberOfChannels));
    this.dsp = dsp;
    this.loop = loop;
    this.applyDsp(dsp);
    await this.prepareStretch(this.activeBuffer);
    this.emitTime();
    return this.activeBuffer;
  }

  async setReverse(reverse: boolean): Promise<void> {
    if (!this.baseBuffer || !this.context || this.reverse === reverse) return;
    const wasPlaying = this.playing;
    const mirroredPosition = clamp(this.durationSec - this.positionSec, 0, this.durationSec);
    await this.stop(false);
    this.reverse = reverse;
    this.activeBuffer = cloneAudioBuffer(this.context, this.baseBuffer, reverse);
    await this.prepareStretch(this.activeBuffer);
    this.positionSec = mirroredPosition;
    if (wasPlaying) await this.play(this.positionSec);
    else await this.seek(this.positionSec);
  }

  async play(position = this.positionSec): Promise<void> {
    if (!this.activeBuffer || !this.dsp) return;
    await this.resume();
    const context = await this.ensureContext();
    const startPosition = clamp(position, 0, Math.max(0, this.durationSec - 0.01));
    this.positionSec = startPosition;
    this.playing = true;
    if (this.stretch) {
      await this.scheduleStretch({ active: true, input: startPosition, outputTime: context.currentTime + 0.02 });
    } else {
      this.startFallback(startPosition);
    }
    this.startFallbackTicker();
    this.emitTime();
  }

  async pause(): Promise<void> {
    if (!this.playing) return;
    this.positionSec = this.readPosition();
    this.playing = false;
    if (this.stretch && this.context) {
      await this.scheduleStretch({ active: false, input: this.positionSec, outputTime: this.context.currentTime });
    }
    this.stopFallbackSource();
    this.emitTime();
  }

  async stop(resetPosition = true): Promise<void> {
    this.positionSec = resetPosition ? 0 : this.readPosition();
    this.playing = false;
    if (this.stretch && this.context) {
      await this.scheduleStretch({ active: false, input: this.positionSec, outputTime: this.context.currentTime });
    }
    this.stopFallbackSource();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
    this.emitTime();
  }

  async seek(position: number, keepPlaying = this.playing): Promise<void> {
    this.positionSec = clamp(position, 0, this.durationSec);
    if (this.stretch && this.context) {
      await this.scheduleStretch({
        active: keepPlaying,
        input: this.positionSec,
        outputTime: this.context.currentTime + (keepPlaying ? 0.015 : 0)
      });
    } else if (keepPlaying) {
      this.startFallback(this.positionSec);
    }
    this.playing = keepPlaying;
    this.emitTime();
  }

  async updateDsp(dsp: DspState): Promise<void> {
    this.dsp = dsp;
    this.applyDsp(dsp);
    if (this.stretch && this.context && this.activeBuffer) {
      await this.scheduleStretch({
        active: this.playing,
        input: this.readPosition(),
        outputTime: this.context.currentTime + 0.015
      });
    } else if (this.playing) {
      this.startFallback(this.readPosition());
    }
  }

  async updateLoop(loop: LoopState): Promise<void> {
    this.loop = loop;
    if (this.stretch && this.context && this.activeBuffer) {
      await this.scheduleStretch({
        active: this.playing,
        input: this.readPosition(),
        outputTime: this.context.currentTime + 0.015
      });
    }
  }

  getLevel(): { rms: number; peak: number; clipping: boolean } {
    if (!this.nodes) return { rms: 0, peak: 0, clipping: false };
    const data = new Float32Array(this.nodes.analyser.fftSize);
    this.nodes.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    let peak = 0;
    for (const sample of data) {
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return {
      rms: Math.sqrt(sum / data.length),
      peak,
      clipping: peak > 0.98
    };
  }

  private setupGraph(context: AudioContext): void {
    const preamp = context.createGain();
    const panner = context.createStereoPanner();
    const eq = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((freq) => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });
    const compressor = context.createDynamicsCompressor();
    const limiter = context.createDynamicsCompressor();
    const effectsInput = context.createGain();
    const dry = context.createGain();
    const echoDelay = context.createDelay(4);
    const echoFeedback = context.createGain();
    const echoWet = context.createGain();
    const flangerDelay = context.createDelay(0.05);
    const flangerWet = context.createGain();
    const flangerLfo = context.createOscillator();
    const flangerDepth = context.createGain();
    const reverb = context.createConvolver();
    const reverbWet = context.createGain();
    const effectsOutput = context.createGain();
    const mono = context.createGain();
    const analyser = context.createAnalyser();
    const streamDestination = context.createMediaStreamDestination();

    analyser.fftSize = 2048;
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.05;

    preamp.connect(panner);
    let last: AudioNode = panner;
    eq.forEach((filter) => {
      last.connect(filter);
      last = filter;
    });
    last.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(effectsInput);

    effectsInput.connect(dry);
    dry.connect(effectsOutput);
    effectsInput.connect(echoDelay);
    echoDelay.connect(echoFeedback);
    echoFeedback.connect(echoDelay);
    echoDelay.connect(echoWet);
    echoWet.connect(effectsOutput);
    effectsInput.connect(flangerDelay);
    flangerDelay.connect(flangerWet);
    flangerWet.connect(effectsOutput);
    effectsInput.connect(reverb);
    reverb.connect(reverbWet);
    reverbWet.connect(effectsOutput);
    flangerLfo.connect(flangerDepth);
    flangerDepth.connect(flangerDelay.delayTime);
    flangerLfo.start();

    effectsOutput.connect(mono);
    mono.connect(analyser);
    analyser.connect(streamDestination);

    const hiddenAudio = document.createElement('audio');
    hiddenAudio.srcObject = streamDestination.stream;
    hiddenAudio.autoplay = true;
    hiddenAudio.setAttribute('playsinline', 'true');
    hiddenAudio.style.display = 'none';
    document.body.appendChild(hiddenAudio);

    this.hiddenAudio = hiddenAudio;
    this.nodes = {
      preamp,
      panner,
      eq,
      compressor,
      limiter,
      effectsInput,
      dry,
      echoDelay,
      echoFeedback,
      echoWet,
      flangerDelay,
      flangerWet,
      flangerLfo,
      flangerDepth,
      reverb,
      reverbWet,
      effectsOutput,
      mono,
      analyser,
      streamDestination
    };
    this.setReverbImpulse(1.6);
  }

  private async prepareStretch(buffer: AudioBuffer): Promise<void> {
    if (!this.context || !this.nodes) return;
    this.stretch?.disconnect();
    this.usingStretch = false;
    try {
      this.stretch = await SignalsmithStretch(this.context, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [this.channelCount],
        channelCount: this.channelCount
      });
      await this.stretch.configure({ preset: 'default', splitComputation: true });
      await this.stretch.setUpdateInterval(0.03, (time) => this.handleStretchTime(time));
      const channels = Array.from({ length: this.channelCount }, (_, channel) =>
        buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)).slice()
      );
      await this.stretch.dropBuffers();
      await this.stretch.addBuffers(channels);
      this.stretch.connect(this.nodes.preamp);
      this.usingStretch = true;
      await this.scheduleStretch({ active: false, input: this.positionSec, outputTime: this.context.currentTime });
    } catch {
      this.stretch = undefined;
      this.usingStretch = false;
    }
  }

  private async scheduleStretch(partial: StretchSchedule): Promise<void> {
    if (!this.stretch || !this.context || !this.dsp) return;
    const loopStart =
      this.loop?.enabled && typeof this.loop.aSec === 'number' && typeof this.loop.bSec === 'number'
        ? Math.min(this.loop.aSec, this.loop.bSec)
        : 0;
    const loopEnd =
      this.loop?.enabled && typeof this.loop.aSec === 'number' && typeof this.loop.bSec === 'number'
        ? Math.max(this.loop.aSec, this.loop.bSec)
        : 0;
    const outputTime = partial.outputTime ?? this.context.currentTime;
    await this.stretch.schedule(
      {
        output: outputTime,
        outputTime,
        rate: getEffectiveTempo(this.dsp),
        semitones: getEffectivePitch(this.dsp),
        formantCompensation: this.dsp.formantCorrection,
        formantBaseHz: this.dsp.formantBaseHz,
        tonalityHz: 8000,
        loopStart,
        loopEnd,
        ...partial
      },
      true
    );
  }

  private applyDsp(dsp: DspState): void {
    if (!this.context || !this.nodes) return;
    const now = this.context.currentTime;
    const smooth = 0.018;
    const set = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, smooth);
    };

    set(this.nodes.preamp.gain, dbToGain(dsp.preampDb));
    set(this.nodes.panner.pan, clamp(dsp.balance, -1, 1));
    dsp.eq.bands.forEach((band, index) => {
      const filter = this.nodes?.eq[index];
      if (!filter) return;
      set(filter.frequency, band.freq);
      set(filter.Q, band.q);
      set(filter.gain, dsp.eq.enabled ? band.gainDb : 0);
    });

    const compressor = this.nodes.compressor;
    set(compressor.threshold, dsp.dynamics.compressorEnabled ? dsp.dynamics.thresholdDb : 0);
    set(compressor.ratio, dsp.dynamics.compressorEnabled ? dsp.dynamics.ratio : 1);
    set(compressor.attack, dsp.dynamics.attackMs / 1000);
    set(compressor.release, dsp.dynamics.releaseMs / 1000);

    const limiter = this.nodes.limiter;
    set(limiter.threshold, dsp.dynamics.limiterEnabled ? dsp.dynamics.ceilingDb : 0);
    set(limiter.ratio, dsp.dynamics.limiterEnabled ? 20 : 1);

    set(this.nodes.dry.gain, 1);
    set(this.nodes.echoDelay.delayTime, clamp(dsp.effects.echoDelayMs / 1000, 0.02, 4));
    set(this.nodes.echoFeedback.gain, dsp.effects.echoEnabled ? clamp(dsp.effects.echoFeedback, 0, 0.85) : 0);
    set(this.nodes.echoWet.gain, dsp.effects.echoEnabled ? clamp(dsp.effects.echoMix, 0, 0.8) : 0);
    set(this.nodes.flangerDelay.delayTime, 0.004);
    set(this.nodes.flangerLfo.frequency, dsp.effects.flangerRateHz);
    set(this.nodes.flangerDepth.gain, dsp.effects.flangerEnabled ? dsp.effects.flangerDepthMs / 1000 : 0);
    set(this.nodes.flangerWet.gain, dsp.effects.flangerEnabled ? dsp.effects.flangerMix : 0);
    set(this.nodes.reverbWet.gain, dsp.effects.reverbEnabled ? dsp.effects.reverbMix : 0);
    set(this.nodes.mono.gain, 1);
    if (Math.abs(this.reverbSeconds - dsp.effects.reverbSeconds) > 0.1) {
      this.setReverbImpulse(dsp.effects.reverbSeconds);
    }
  }

  private setReverbImpulse(seconds: number): void {
    if (!this.context || !this.nodes) return;
    const length = Math.max(1, Math.floor(this.context.sampleRate * seconds));
    const impulse = this.context.createBuffer(2, length, this.context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const decay = (1 - i / length) ** 2;
        data[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    this.nodes.reverb.buffer = impulse;
    this.reverbSeconds = seconds;
  }

  private startFallback(position: number): void {
    if (!this.context || !this.nodes || !this.activeBuffer || !this.dsp) return;
    this.stopFallbackSource();
    const source = this.context.createBufferSource();
    source.buffer = this.activeBuffer;
    source.playbackRate.value = getEffectiveTempo(this.dsp);
    source.detune.value = getEffectivePitch(this.dsp) * 100;
    source.connect(this.nodes.preamp);
    source.onended = () => {
      if (!this.playing) return;
      if (this.loop?.enabled && typeof this.loop.aSec === 'number') {
        void this.seek(this.loop.aSec, true);
        return;
      }
      this.playing = false;
      this.positionSec = this.durationSec;
      this.emitTime();
      this.onEnded?.();
    };
    source.start(0, position);
    this.fallbackSource = source;
    this.sourceStartedAt = this.context.currentTime;
    this.sourceStartPosition = position;
  }

  private stopFallbackSource(): void {
    if (!this.fallbackSource) return;
    const source = this.fallbackSource;
    this.fallbackSource = undefined;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
  }

  private startFallbackTicker(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const tick = () => {
      if (this.playing) {
        this.positionSec = this.readPosition();
        if (this.loop?.enabled && typeof this.loop.aSec === 'number' && typeof this.loop.bSec === 'number') {
          if (this.positionSec >= this.loop.bSec) void this.seek(this.loop.aSec, true);
        } else if (this.positionSec >= this.durationSec - 0.02) {
          void this.stop(false);
          this.positionSec = this.durationSec;
          this.onEnded?.();
        }
      }
      this.emitTime();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private readPosition(): number {
    if (this.stretch) return clamp(this.stretch.inputTime, 0, this.durationSec);
    if (!this.context || !this.playing || !this.dsp) return clamp(this.positionSec, 0, this.durationSec);
    const elapsed = (this.context.currentTime - this.sourceStartedAt) * getEffectiveTempo(this.dsp);
    return clamp(this.sourceStartPosition + elapsed, 0, this.durationSec);
  }

  private handleStretchTime(time: number): void {
    this.positionSec = clamp(time, 0, this.durationSec);
    if (this.playing && this.durationSec > 0 && this.positionSec >= this.durationSec - 0.02) {
      void this.stop(false);
      this.positionSec = this.durationSec;
      this.onEnded?.();
    }
    this.emitTime();
  }

  private emitTime(): void {
    this.onTime?.(this.positionSec, this.durationSec);
  }
}

export const audioEngine = new TempoAudioEngine();
