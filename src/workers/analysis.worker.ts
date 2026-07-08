interface AnalysisRequest {
  type: 'analysis';
  samples: Float32Array;
  sampleRate: number;
}

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function estimateBpm(samples: Float32Array, sampleRate: number): { bpm?: number; confidence: number } {
  const frame = 1024;
  const hopRate = sampleRate / frame;
  const frames = Math.min(Math.floor(samples.length / frame), Math.floor(hopRate * 180));
  if (frames < hopRate * 8) return { confidence: 0 };
  const energy = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    const offset = i * frame;
    for (let j = 0; j < frame; j += 1) sum += Math.abs(samples[offset + j] ?? 0);
    energy[i] = sum / frame;
  }
  const onset = new Float32Array(frames);
  for (let i = 1; i < frames; i += 1) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  let bestBpm = 0;
  let bestScore = 0;
  let secondScore = 0;
  for (let bpm = 55; bpm <= 210; bpm += 1) {
    const lag = Math.round((60 / bpm) * hopRate);
    if (lag < 1 || lag >= frames) continue;
    let score = 0;
    for (let i = 0; i < frames - lag; i += 1) score += onset[i] * onset[i + lag];
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestBpm = bpm;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  const confidence = bestScore > 0 ? Math.min(0.96, Math.max(0.25, (bestScore - secondScore) / bestScore + 0.35)) : 0;
  return bestBpm ? { bpm: bestBpm, confidence } : { confidence: 0 };
}

function estimateKey(samples: Float32Array, sampleRate: number): { key?: string; confidence: number } {
  const maxSamples = Math.min(samples.length, sampleRate * 40);
  const bucket = new Float32Array(12);
  const windowSize = 4096;
  for (let start = 0; start + windowSize < maxSamples; start += windowSize * 2) {
    let crossings = 0;
    let last = samples[start] ?? 0;
    let rms = 0;
    for (let i = 1; i < windowSize; i += 1) {
      const value = samples[start + i] ?? 0;
      if ((last <= 0 && value > 0) || (last >= 0 && value < 0)) crossings += 1;
      rms += value * value;
      last = value;
    }
    rms = Math.sqrt(rms / windowSize);
    const freq = (crossings * sampleRate) / (2 * windowSize);
    if (freq >= 55 && freq <= 1600 && rms > 0.005) {
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      bucket[((midi % 12) + 12) % 12] += rms;
    }
  }
  let best = 0;
  let index = -1;
  let total = 0;
  for (let i = 0; i < 12; i += 1) {
    total += bucket[i];
    if (bucket[i] > best) {
      best = bucket[i];
      index = i;
    }
  }
  if (index < 0 || total === 0) return { confidence: 0 };
  return { key: noteNames[index], confidence: Math.min(0.72, Math.max(0.25, best / total + 0.15)) };
}

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { samples, sampleRate } = event.data;
  const bpm = estimateBpm(samples, sampleRate);
  const key = estimateKey(samples, sampleRate);
  self.postMessage({
    type: 'analysis',
    result: {
      originalBpm: bpm.bpm,
      correctedBpm: bpm.bpm,
      key: key.key,
      confidence: Math.max(bpm.confidence, key.confidence),
      analyzedAt: Date.now(),
      error: bpm.bpm || key.key ? undefined : '분석할 리듬/음정 정보가 부족합니다.'
    }
  });
};

export {};
