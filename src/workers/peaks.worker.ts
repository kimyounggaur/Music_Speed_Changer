interface PeaksRequest {
  type: 'peaks';
  channels: Float32Array[];
  points: number;
}

self.onmessage = (event: MessageEvent<PeaksRequest>) => {
  const { channels, points } = event.data;
  const length = channels[0]?.length ?? 0;
  const samplesPerPoint = Math.max(1, Math.floor(length / points));
  const peaks: number[] = [];
  for (let point = 0; point < points; point += 1) {
    const start = point * samplesPerPoint;
    const end = Math.min(length, start + samplesPerPoint);
    let peak = 0;
    for (let channel = 0; channel < channels.length; channel += 1) {
      const data = channels[channel];
      for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(data[i] ?? 0));
    }
    peaks.push(peak);
  }
  self.postMessage({ type: 'peaks', peaks, resolution: samplesPerPoint });
};

export {};
