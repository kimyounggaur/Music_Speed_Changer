import type { AnalysisResult, DspState, LoopState, Track } from '../types';

export const supportedExtensions = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac', 'opus', 'webm'];

export function createId(prefix = 'id'): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${Array.from(random)
    .map((n) => n.toString(36))
    .join('')}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatTime(seconds = 0): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = Math.floor(abs % 60)
    .toString()
    .padStart(2, '0');
  return h > 0 ? `${sign}${h}:${m.toString().padStart(2, '0')}:${s}` : `${sign}${m}:${s}`;
}

export function formatBytes(bytes = 0): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function tempoFactor(dsp: DspState): number {
  return dsp.tempoPercent / 100;
}

export function pitchRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

export function rateModeSemitones(ratePercent: number): number {
  return 12 * Math.log2(ratePercent / 100);
}

export function getEffectivePitch(dsp: DspState): number {
  return dsp.joinedRateMode ? rateModeSemitones(dsp.tempoPercent) : dsp.pitchSemitones;
}

export function getEffectiveTempo(dsp: DspState): number {
  return dsp.tempoPercent / 100;
}

export function getAdjustedBpm(track?: Track, dsp?: DspState): number | undefined {
  const bpm = track?.analysis?.correctedBpm ?? track?.analysis?.originalBpm;
  if (!bpm || !dsp) return bpm;
  return bpm * getEffectiveTempo(dsp);
}

const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const camelotMajor = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];

export function transposeKey(key: string | undefined, semitones: number): string | undefined {
  if (!key) return undefined;
  const clean = key.replace('m', '').trim().toUpperCase();
  const index = keys.indexOf(clean);
  if (index < 0) return key;
  const next = (index + Math.round(semitones) + 120) % 12;
  return keys[next];
}

export function keyToCamelot(key?: string): string | undefined {
  if (!key) return undefined;
  const index = keys.indexOf(key.replace('m', '').toUpperCase());
  return index >= 0 ? camelotMajor[index] : undefined;
}

export function isSupportedAudioFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return file.type.startsWith('audio/') || supportedExtensions.includes(ext);
}

export function makeTrackName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

export function cloneAudioBuffer(context: BaseAudioContext, source: AudioBuffer, reverse = false): AudioBuffer {
  const copy = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const src = source.getChannelData(channel);
    const dst = copy.getChannelData(channel);
    if (reverse) {
      for (let i = 0; i < src.length; i += 1) dst[i] = src[src.length - 1 - i];
    } else {
      dst.set(src);
    }
  }
  return copy;
}

export function loopLength(loop: LoopState): number | undefined {
  if (typeof loop.aSec !== 'number' || typeof loop.bSec !== 'number') return undefined;
  return Math.max(0, loop.bSec - loop.aSec);
}

export function createFileName(track: Track, dsp: DspState, extension: string): string {
  const tempo = `x${(dsp.tempoPercent / 100).toFixed(2).replace(/\.?0+$/, '')}`;
  const pitch = `${getEffectivePitch(dsp) >= 0 ? '+' : ''}${getEffectivePitch(dsp).toFixed(1)}st`;
  return `${track.name}_${tempo}_${pitch}.${extension}`;
}

export function updateAnalysisForDisplay(track: Track | undefined, dsp: DspState): AnalysisResult | undefined {
  if (!track?.analysis) return undefined;
  const adjustedBpm = getAdjustedBpm(track, dsp);
  const adjustedKey = transposeKey(track.analysis.key, getEffectivePitch(dsp));
  return {
    ...track.analysis,
    correctedBpm: adjustedBpm,
    key: adjustedKey,
    camelot: keyToCamelot(adjustedKey)
  };
}

export function downloadBlob(blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  return url;
}

export function getLocalAddressHint(): string {
  return '같은 와이파이에서 PC의 IPv4 주소를 확인한 뒤 http://PC주소:5173 으로 접속하세요.';
}
