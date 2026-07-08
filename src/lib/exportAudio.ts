import type { DspState, ExportJob, LoopState } from '../types';

export function exportAudioBuffer(
  audioBuffer: AudioBuffer,
  dsp: DspState,
  loop: LoopState,
  options: {
    target: 'full' | 'loop';
    format: 'wav' | 'mp3';
    bitDepth: 16 | 24;
    mp3Kbps: number;
    normalize: boolean;
    onProgress: (progress: number, phase: string) => void;
  }
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'progress') options.onProgress(event.data.progress, event.data.phase);
      if (event.data.type === 'done') {
        worker.terminate();
        resolve(event.data.blob);
      }
      if (event.data.type === 'error') {
        worker.terminate();
        reject(new Error(event.data.error));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    const channels = Array.from({ length: Math.min(2, audioBuffer.numberOfChannels) }, (_, channel) =>
      audioBuffer.getChannelData(channel).slice()
    );
    worker.postMessage({
      type: 'export',
      channels,
      sampleRate: audioBuffer.sampleRate,
      dsp,
      loop,
      target: options.target,
      format: options.format,
      bitDepth: options.bitDepth,
      mp3Kbps: options.mp3Kbps,
      normalize: options.normalize
    });
  });
}

export function createIdleExportJob(overrides: Partial<ExportJob>): ExportJob {
  return {
    id: overrides.id ?? 'export_idle',
    fileName: overrides.fileName ?? 'export.wav',
    format: overrides.format ?? 'wav',
    target: overrides.target ?? 'full',
    progress: overrides.progress ?? 0,
    phase: overrides.phase ?? '대기',
    status: overrides.status ?? 'idle',
    url: overrides.url,
    blob: overrides.blob,
    error: overrides.error
  };
}
