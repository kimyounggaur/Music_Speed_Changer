import type { DspState, LoopState } from '../types';

interface ExportRequest {
  type: 'export';
  channels: Float32Array[];
  sampleRate: number;
  dsp: DspState;
  loop: LoopState;
  target: 'full' | 'loop';
  format: 'wav' | 'mp3';
  bitDepth: 16 | 24;
  mp3Kbps: number;
  normalize: boolean;
}

function postProgress(progress: number, phase: string): void {
  self.postMessage({ type: 'progress', progress, phase });
}

function sliceChannels(channels: Float32Array[], sampleRate: number, loop: LoopState, target: 'full' | 'loop'): Float32Array[] {
  if (target !== 'loop' || typeof loop.aSec !== 'number' || typeof loop.bSec !== 'number') return channels;
  const start = Math.max(0, Math.floor(Math.min(loop.aSec, loop.bSec) * sampleRate));
  const end = Math.min(channels[0].length, Math.floor(Math.max(loop.aSec, loop.bSec) * sampleRate));
  return channels.map((channel) => channel.slice(start, Math.max(start + 1, end)));
}

function renderSimple(channels: Float32Array[], dsp: DspState): Float32Array[] {
  const tempo = Math.max(0.05, dsp.tempoPercent / 100);
  const pitch = 2 ** ((dsp.joinedRateMode ? 12 * Math.log2(dsp.tempoPercent / 100) : dsp.pitchSemitones) / 12);
  const sourceLength = channels[0].length;
  const outputLength = Math.max(1, Math.floor(sourceLength / tempo));
  const rendered = channels.map(() => new Float32Array(outputLength));
  for (let channel = 0; channel < channels.length; channel += 1) {
    const input = channels[channel];
    const output = rendered[channel];
    for (let i = 0; i < outputLength; i += 1) {
      const srcIndex = i * tempo * pitch;
      const left = Math.floor(srcIndex);
      const frac = srcIndex - left;
      const a = input[left] ?? 0;
      const b = input[Math.min(input.length - 1, left + 1)] ?? 0;
      output[i] = a + (b - a) * frac;
    }
  }
  return rendered;
}

function normalize(channels: Float32Array[], ceilingDb: number): void {
  let peak = 0;
  channels.forEach((channel) => channel.forEach((sample) => (peak = Math.max(peak, Math.abs(sample)))));
  if (peak <= 0) return;
  const ceiling = 10 ** (ceilingDb / 20);
  const gain = Math.min(1 / peak, ceiling / peak);
  channels.forEach((channel) => {
    for (let i = 0; i < channel.length; i += 1) channel[i] *= gain;
  });
}

function encodeWav(channels: Float32Array[], sampleRate: number, bitDepth: 16 | 24): Blob {
  const channelCount = channels.length;
  const length = channels[0].length;
  const bytesPerSample = bitDepth / 8;
  const dataSize = length * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;
  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset++, value.charCodeAt(i));
  };
  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channelCount, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * channelCount * bytesPerSample, true);
  offset += 4;
  view.setUint16(offset, channelCount * bytesPerSample, true);
  offset += 2;
  view.setUint16(offset, bitDepth, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;
  for (let i = 0; i < length; i += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i] ?? 0));
      if (bitDepth === 16) {
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      } else {
        const value = sample < 0 ? sample * 0x800000 : sample * 0x7fffff;
        let int24 = Math.round(value);
        if (int24 < 0) int24 += 0x1000000;
        view.setUint8(offset, int24 & 0xff);
        view.setUint8(offset + 1, (int24 >> 8) & 0xff);
        view.setUint8(offset + 2, (int24 >> 16) & 0xff);
        offset += 3;
      }
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function floatTo16Bit(channel: Float32Array): Int16Array {
  const output = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, channel[i] ?? 0));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

async function encodeMp3(channels: Float32Array[], sampleRate: number, kbps: number): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const channelCount = Math.min(2, channels.length);
  const encoder = new Mp3Encoder(channelCount, sampleRate, kbps);
  const left = floatTo16Bit(channels[0]);
  const right = floatTo16Bit(channels[1] ?? channels[0]);
  const parts: ArrayBuffer[] = [];
  const block = 1152;
  for (let i = 0; i < left.length; i += block) {
    const mp3buf =
      channelCount === 1
        ? encoder.encodeBuffer(left.subarray(i, i + block))
        : encoder.encodeBuffer(left.subarray(i, i + block), right.subarray(i, i + block));
    if (mp3buf.length > 0) {
      const copy = new Uint8Array(mp3buf.byteLength);
      copy.set(mp3buf);
      parts.push(copy.buffer);
    }
    if (i % (block * 40) === 0) postProgress(0.75 + (i / left.length) * 0.2, 'MP3 인코딩');
  }
  const end = encoder.flush();
  if (end.length > 0) {
    const copy = new Uint8Array(end.byteLength);
    copy.set(end);
    parts.push(copy.buffer);
  }
  return new Blob(parts, { type: 'audio/mpeg' });
}

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  if (event.data.type !== 'export') return;
  try {
    postProgress(0.05, '구간 준비');
    const sliced = sliceChannels(event.data.channels, event.data.sampleRate, event.data.loop, event.data.target);
    postProgress(0.2, '속도/음정 처리');
    const rendered = renderSimple(sliced, event.data.dsp);
    if (event.data.normalize) {
      postProgress(0.55, '피크 정규화');
      normalize(rendered, event.data.dsp.dynamics.ceilingDb);
    }
    postProgress(0.72, '파일 인코딩');
    const blob =
      event.data.format === 'mp3'
        ? await encodeMp3(rendered, event.data.sampleRate, event.data.mp3Kbps)
        : encodeWav(rendered, event.data.sampleRate, event.data.bitDepth);
    self.postMessage({ type: 'done', blob });
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
