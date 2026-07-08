declare module 'signalsmith-stretch' {
  export interface StretchSchedule {
    output?: number;
    outputTime?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  }

  export interface StretchNode extends AudioWorkletNode {
    inputTime: number;
    schedule: (schedule: StretchSchedule, adjustPrevious?: boolean) => Promise<StretchSchedule>;
    start: (
      when?: number | StretchSchedule,
      offset?: number,
      duration?: number,
      rate?: number,
      semitones?: number
    ) => Promise<StretchSchedule>;
    stop: (when?: number) => Promise<StretchSchedule>;
    addBuffers: (buffers: Float32Array[]) => Promise<number>;
    dropBuffers: (toSeconds?: number) => Promise<{ start: number; end: number }>;
    setUpdateInterval: (seconds: number, callback?: (inputTime: number) => void) => Promise<void>;
    configure: (config: {
      blockMs?: number | null;
      intervalMs?: number;
      splitComputation?: boolean;
      preset?: 'default' | 'cheaper';
    }) => Promise<void>;
    latency: () => Promise<number>;
  }

  export default function SignalsmithStretch(
    audioContext: AudioContext,
    options?: AudioWorkletNodeOptions
  ): Promise<StretchNode>;
}
