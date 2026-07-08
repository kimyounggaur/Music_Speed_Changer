import type { AppSettings, DspState, EqBand, LoopState, PlaybackState } from '../types';

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const defaultEqBands: EqBand[] = EQ_FREQUENCIES.map((freq) => ({
  freq,
  gainDb: 0,
  q: 1.1
}));

export const defaultDspState: DspState = {
  tempoPercent: 100,
  pitchSemitones: 0,
  joinedRateMode: false,
  formantCorrection: true,
  formantBaseHz: 0,
  preampDb: -3,
  balance: 0,
  eq: {
    enabled: true,
    compact8Band: false,
    preset: 'flat',
    bands: defaultEqBands
  },
  effects: {
    vocalReduction: 0,
    echoEnabled: false,
    echoMix: 0.24,
    echoFeedback: 0.28,
    echoDelayMs: 375,
    echoSync: 'free',
    flangerEnabled: false,
    flangerMix: 0.18,
    flangerRateHz: 0.2,
    flangerDepthMs: 4,
    reverbEnabled: false,
    reverbMix: 0.18,
    reverbSeconds: 1.6,
    mono: false
  },
  dynamics: {
    compressorEnabled: false,
    thresholdDb: -20,
    ratio: 3,
    attackMs: 5,
    releaseMs: 120,
    limiterEnabled: true,
    ceilingDb: -1,
    normalizeOnExport: true
  }
};

export const defaultLoopState: LoopState = {
  enabled: false,
  crossfadeMs: 10,
  beatsPerBar: 4,
  snapToBeat: false
};

export const defaultPlaybackState: PlaybackState = {
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  positionSec: 0,
  durationSec: 0,
  repeatMode: 'queue',
  shuffle: false,
  shuffleQueue: [],
  reverse: false
};

export const defaultSettings: AppSettings = {
  theme: 'dark',
  accentColor: '#38d5ff',
  jumpSeconds: 5,
  tempoMin: 15,
  tempoMax: 500,
  pitchRange: 24,
  semitoneSnap: false,
  showStepButtons: true,
  qualityMode: 'practice',
  rememberPerTrack: true,
  reduceMotion: false,
  fontScale: 1,
  exportFormat: 'wav',
  exportBitDepth: 16,
  exportMp3Kbps: 192
};
