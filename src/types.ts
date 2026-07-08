export type ID = string;
export type TabKey = 'library' | 'player' | 'queue' | 'settings';
export type RepeatMode = 'stop' | 'queue' | 'repeat-queue' | 'repeat-track';
export type ThemeMode = 'dark' | 'light' | 'system' | 'amoled';
export type SourceKind = 'file' | 'recording' | 'export';

export interface Track {
  id: ID;
  sourceKind: SourceKind;
  name: string;
  title?: string;
  artist?: string;
  durationSec: number;
  sampleRate?: number;
  channels?: number;
  fileSize?: number;
  mimeType?: string;
  audioBlobId: ID;
  peaksBlobId?: ID;
  importedAt: number;
  lastPlayedAt?: number;
  lastPositionSec?: number;
  analysis?: AnalysisResult;
  remembered?: {
    dsp?: Partial<DspState>;
    loop?: LoopState;
  };
}

export interface AnalysisResult {
  originalBpm?: number;
  correctedBpm?: number;
  key?: string;
  confidence?: number;
  camelot?: string;
  analyzedAt?: number;
  error?: string;
}

export interface PlaybackState {
  trackId?: ID;
  queue: ID[];
  queueIndex: number;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  shuffleQueue: ID[];
  reverse: boolean;
}

export interface EqBand {
  freq: number;
  gainDb: number;
  q: number;
}

export interface EqState {
  enabled: boolean;
  compact8Band: boolean;
  preset: string;
  bands: EqBand[];
}

export interface EffectsState {
  vocalReduction: number;
  echoEnabled: boolean;
  echoMix: number;
  echoFeedback: number;
  echoDelayMs: number;
  echoSync: 'free' | '1/2' | '1/4' | '1/8' | 'dotted-1/4' | 'triplet-1/4';
  flangerEnabled: boolean;
  flangerMix: number;
  flangerRateHz: number;
  flangerDepthMs: number;
  reverbEnabled: boolean;
  reverbMix: number;
  reverbSeconds: number;
  mono: boolean;
}

export interface DynamicsState {
  compressorEnabled: boolean;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  limiterEnabled: boolean;
  ceilingDb: number;
  normalizeOnExport: boolean;
}

export interface DspState {
  tempoPercent: number;
  pitchSemitones: number;
  joinedRateMode: boolean;
  formantCorrection: boolean;
  formantBaseHz: number;
  preampDb: number;
  balance: number;
  eq: EqState;
  effects: EffectsState;
  dynamics: DynamicsState;
}

export interface LoopState {
  enabled: boolean;
  aSec?: number;
  bSec?: number;
  crossfadeMs: number;
  beatsPerBar: number;
  snapToBeat: boolean;
}

export interface Marker {
  id: ID;
  trackId: ID;
  label: string;
  timeSec: number;
  color?: string;
}

export interface Playlist {
  id: ID;
  name: string;
  trackIds: ID[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  theme: ThemeMode;
  accentColor: string;
  jumpSeconds: number;
  tempoMin: number;
  tempoMax: number;
  pitchRange: 12 | 24 | 48;
  semitoneSnap: boolean;
  showStepButtons: boolean;
  qualityMode: 'practice' | 'quality' | 'battery';
  rememberPerTrack: boolean;
  reduceMotion: boolean;
  fontScale: number;
  exportFormat: 'wav' | 'mp3';
  exportBitDepth: 16 | 24;
  exportMp3Kbps: 128 | 192 | 256 | 320;
}

export interface ToastMessage {
  id: ID;
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface ExportJob {
  id: ID;
  fileName: string;
  format: 'wav' | 'mp3';
  target: 'full' | 'loop';
  progress: number;
  phase: string;
  status: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
  url?: string;
  blob?: Blob;
  error?: string;
}

export interface ImportProgress {
  fileName: string;
  state: 'waiting' | 'decoding' | 'saving' | 'done' | 'skipped' | 'failed';
  message?: string;
}
