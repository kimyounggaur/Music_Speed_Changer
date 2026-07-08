import { create } from 'zustand';
import type {
  AnalysisResult,
  AppSettings,
  DspState,
  ExportJob,
  ID,
  ImportProgress,
  LoopState,
  Marker,
  PlaybackState,
  Playlist,
  TabKey,
  ToastMessage,
  Track
} from '../types';
import { defaultDspState, defaultLoopState, defaultPlaybackState, defaultSettings } from '../lib/defaults';
import {
  deleteMarker as dbDeleteMarker,
  deletePlaylist as dbDeletePlaylist,
  deleteTrack as dbDeleteTrack,
  estimateStorage,
  getAudioBlob,
  getMarkers,
  getPeaks,
  getPlaylists,
  getTracks,
  loadSettings,
  saveExportHistory,
  saveMarker as dbSaveMarker,
  savePeaks,
  savePlaylist as dbSavePlaylist,
  saveSettings,
  saveTrack,
  updateTrack
} from '../lib/db';
import { audioEngine } from '../lib/audioEngine';
import { exportAudioBuffer } from '../lib/exportAudio';
import {
  clamp,
  createFileName,
  createId,
  downloadBlob,
  formatBytes,
  getEffectivePitch,
  isSupportedAudioFile,
  makeTrackName
} from '../lib/utils';

interface StorageInfo {
  usage: number;
  quota: number;
  label: string;
}

interface AppState {
  activeTab: TabKey;
  tracks: Track[];
  currentTrack?: Track;
  currentBuffer?: AudioBuffer;
  playback: PlaybackState;
  dsp: DspState;
  loop: LoopState;
  markers: Marker[];
  playlists: Playlist[];
  settings: AppSettings;
  importProgress: ImportProgress[];
  toasts: ToastMessage[];
  peaks: number[];
  zoom: number;
  analysisBusy: boolean;
  exportJob?: ExportJob;
  storage: StorageInfo;
  engineReady: boolean;
  engineMode: 'signalsmith' | 'fallback' | 'idle';
  initialized: boolean;

  initialize: () => Promise<void>;
  setActiveTab: (tab: TabKey) => void;
  importFiles: (files: FileList | File[]) => Promise<void>;
  openTrack: (trackId: ID, autoplay?: boolean) => Promise<void>;
  togglePlay: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (position: number) => Promise<void>;
  jump: (delta: number) => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  setDsp: (patch: Partial<DspState>) => Promise<void>;
  setNestedDsp: <K extends keyof DspState>(key: K, value: DspState[K]) => Promise<void>;
  setLoop: (loop: LoopState) => Promise<void>;
  setLoopPoint: (point: 'a' | 'b') => Promise<void>;
  moveLoop: (direction: -1 | 1, bars?: boolean) => Promise<void>;
  clearLoop: () => Promise<void>;
  addMarker: () => Promise<void>;
  deleteMarker: (id: ID) => Promise<void>;
  goToMarker: (id: ID) => Promise<void>;
  setRepeatMode: (mode: PlaybackState['repeatMode']) => void;
  toggleShuffle: () => void;
  reorderQueue: (from: number, to: number) => void;
  removeFromQueue: (trackId: ID) => void;
  clearQueue: () => void;
  createPlaylistFromQueue: (name: string) => Promise<void>;
  savePlaylist: (playlist: Playlist) => Promise<void>;
  deletePlaylist: (id: ID) => Promise<void>;
  deleteTrack: (id: ID) => Promise<void>;
  startAnalysis: () => Promise<void>;
  setTrackAnalysis: (trackId: ID, analysis: Partial<AnalysisResult>) => Promise<void>;
  exportCurrent: (target: 'full' | 'loop', format?: 'wav' | 'mp3') => Promise<void>;
  addExportToLibrary: () => Promise<void>;
  saveRecording: (blob: Blob, durationSec: number) => Promise<ID>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refreshStorage: () => Promise<void>;
  pushToast: (tone: ToastMessage['tone'], message: string) => void;
  dismissToast: (id: ID) => void;
  setZoom: (zoom: number) => void;
  handleEnginePosition: (positionSec: number, durationSec: number) => void;
  handleTrackEnd: () => Promise<void>;
}

function makeQueueForTrack(tracks: Track[], trackId: ID): { queue: ID[]; queueIndex: number } {
  const queue = tracks.map((track) => track.id);
  const queueIndex = Math.max(0, queue.indexOf(trackId));
  return { queue, queueIndex };
}

function shuffleIds(ids: ID[]): ID[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cloneDsp(patch: Partial<DspState>, base: DspState): DspState {
  return {
    ...base,
    ...patch,
    eq: { ...base.eq, ...(patch.eq ?? {}), bands: patch.eq?.bands ?? base.eq.bands },
    effects: { ...base.effects, ...(patch.effects ?? {}) },
    dynamics: { ...base.dynamics, ...(patch.dynamics ?? {}) }
  };
}

function generatePeaks(buffer: AudioBuffer): Promise<{ peaks: number[]; resolution: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/peaks.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      worker.terminate();
      resolve({ peaks: event.data.peaks, resolution: event.data.resolution });
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) =>
      buffer.getChannelData(channel).slice()
    );
    worker.postMessage({ type: 'peaks', channels, points: 1600 });
  });
}

function analyzeBuffer(buffer: AudioBuffer): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      worker.terminate();
      resolve(event.data.result);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    const samples = buffer.getChannelData(0).slice();
    worker.postMessage({ type: 'analysis', samples, sampleRate: buffer.sampleRate });
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  activeTab: 'library',
  tracks: [],
  playback: defaultPlaybackState,
  dsp: defaultDspState,
  loop: defaultLoopState,
  markers: [],
  playlists: [],
  settings: defaultSettings,
  importProgress: [],
  toasts: [],
  peaks: [],
  zoom: 1,
  analysisBusy: false,
  storage: { usage: 0, quota: 0, label: '0 B' },
  engineReady: false,
  engineMode: 'idle',
  initialized: false,

  initialize: async () => {
    const [tracks, playlists, settings] = await Promise.all([getTracks(), getPlaylists(), loadSettings()]);
    set({ tracks, playlists, settings, initialized: true });
    await get().refreshStorage();
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  importFiles: async (fileInput) => {
    const files = Array.from(fileInput);
    const progress: ImportProgress[] = files.map((file) => ({ fileName: file.name, state: 'waiting' }));
    set({ importProgress: progress });
    const imported: Track[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      set((state) => ({
        importProgress: state.importProgress.map((item, i) =>
          i === index ? { ...item, state: 'decoding', message: '오디오 정보를 읽는 중' } : item
        )
      }));
      if (!isSupportedAudioFile(file)) {
        set((state) => ({
          importProgress: state.importProgress.map((item, i) =>
            i === index ? { ...item, state: 'failed', message: `지원되지 않는 형식: ${file.name}` } : item
          )
        }));
        get().pushToast('warning', `지원되지 않는 형식: ${file.name}`);
        continue;
      }
      try {
        const buffer = await audioEngine.decodeBlob(file);
        const duplicate = get().tracks.find(
          (track) =>
            track.name === makeTrackName(file.name) &&
            track.fileSize === file.size &&
            Math.abs(track.durationSec - buffer.duration) < 0.05
        );
        if (duplicate) {
          set((state) => ({
            importProgress: state.importProgress.map((item, i) =>
              i === index ? { ...item, state: 'skipped', message: '이미 가져온 곡이라 건너뜀' } : item
            )
          }));
          continue;
        }
        const blobId = createId('blob');
        const track: Track = {
          id: createId('track'),
          sourceKind: 'file',
          name: makeTrackName(file.name),
          title: makeTrackName(file.name),
          durationSec: buffer.duration,
          sampleRate: buffer.sampleRate,
          channels: buffer.numberOfChannels,
          fileSize: file.size,
          mimeType: file.type || 'audio/*',
          audioBlobId: blobId,
          importedAt: Date.now()
        };
        set((state) => ({
          importProgress: state.importProgress.map((item, i) =>
            i === index ? { ...item, state: 'saving', message: '기기에 저장하는 중' } : item
          )
        }));
        await saveTrack(track, file);
        imported.push(track);
        set((state) => ({
          tracks: [track, ...state.tracks],
          importProgress: state.importProgress.map((item, i) =>
            i === index ? { ...item, state: 'done', message: '저장 완료' } : item
          )
        }));
        void generatePeaks(buffer).then(({ peaks, resolution }) => savePeaks(track.id, peaks, resolution));
        void analyzeBuffer(buffer).then(async (analysis) => {
          const latest = await getTracks();
          const found = latest.find((item) => item.id === track.id);
          if (!found) return;
          const updated = { ...found, analysis };
          await updateTrack(updated);
          set((state) => ({
            tracks: state.tracks.map((item) => (item.id === updated.id ? updated : item)),
            currentTrack: state.currentTrack?.id === updated.id ? updated : state.currentTrack
          }));
        });
      } catch (error) {
        set((state) => ({
          importProgress: state.importProgress.map((item, i) =>
            i === index
              ? {
                  ...item,
                  state: 'failed',
                  message: error instanceof Error ? error.message : '오디오를 열 수 없습니다.'
                }
              : item
          )
        }));
      }
    }
    if (imported.length > 0) {
      get().pushToast('success', `${imported.length}곡을 라이브러리에 저장했습니다.`);
      await get().openTrack(imported[0].id, true);
    }
    await get().refreshStorage();
  },

  openTrack: async (trackId, autoplay = true) => {
    const track = get().tracks.find((item) => item.id === trackId) ?? (await getTracks()).find((item) => item.id === trackId);
    if (!track) return;
    const blob = await getAudioBlob(track.audioBlobId);
    if (!blob) {
      get().pushToast('error', '저장된 오디오 데이터를 찾을 수 없습니다.');
      return;
    }
    const rememberedDsp = get().settings.rememberPerTrack && track.remembered?.dsp ? cloneDsp(track.remembered.dsp, get().dsp) : get().dsp;
    const rememberedLoop = get().settings.rememberPerTrack && track.remembered?.loop ? track.remembered.loop : get().loop;
    const buffer = await audioEngine.loadBlob(blob, rememberedDsp, rememberedLoop, get().playback.reverse);
    const markers = await getMarkers(track.id);
    const cachedPeaks = await getPeaks(track.id);
    if (!cachedPeaks) {
      void generatePeaks(buffer).then(async ({ peaks, resolution }) => {
        await savePeaks(track.id, peaks, resolution);
        if (get().currentTrack?.id === track.id) set({ peaks });
      });
    }
    const queueInfo = makeQueueForTrack(get().tracks, track.id);
    set((state) => ({
      currentTrack: track,
      currentBuffer: buffer,
      markers,
      peaks: cachedPeaks?.peaks ?? [],
      dsp: rememberedDsp,
      loop: rememberedLoop,
      playback: {
        ...state.playback,
        trackId: track.id,
        queue: state.playback.queue.length > 0 ? state.playback.queue : queueInfo.queue,
        queueIndex:
          state.playback.queue.length > 0 ? Math.max(0, state.playback.queue.indexOf(track.id)) : queueInfo.queueIndex,
        positionSec: track.lastPositionSec ?? 0,
        durationSec: track.durationSec,
        isPlaying: false
      },
      activeTab: 'player',
      engineReady: true,
      engineMode: audioEngine.usesSignalsmith ? 'signalsmith' : 'fallback'
    }));
    if (autoplay) await get().play();
  },

  togglePlay: async () => {
    if (get().playback.isPlaying) await get().pause();
    else await get().play();
  },

  play: async () => {
    const { currentTrack, playback } = get();
    if (!currentTrack) {
      get().pushToast('info', '먼저 오디오를 선택하세요.');
      return;
    }
    await audioEngine.play(playback.positionSec);
    set((state) => ({ playback: { ...state.playback, isPlaying: true } }));
  },

  pause: async () => {
    await audioEngine.pause();
    set((state) => ({ playback: { ...state.playback, isPlaying: false, positionSec: audioEngine.position } }));
  },

  seek: async (position) => {
    await audioEngine.seek(position);
    set((state) => ({ playback: { ...state.playback, positionSec: clamp(position, 0, state.playback.durationSec) } }));
  },

  jump: async (delta) => {
    await get().seek(clamp(get().playback.positionSec + delta, 0, get().playback.durationSec));
  },

  nextTrack: async () => {
    const { playback } = get();
    const queue = playback.shuffle ? playback.shuffleQueue : playback.queue;
    if (queue.length === 0) return;
    let nextIndex = playback.queueIndex + 1;
    if (nextIndex >= queue.length) {
      if (playback.repeatMode === 'repeat-queue') nextIndex = 0;
      else return;
    }
    await get().openTrack(queue[nextIndex], true);
    set((state) => ({ playback: { ...state.playback, queueIndex: nextIndex } }));
  },

  previousTrack: async () => {
    const { playback } = get();
    if (playback.positionSec > 3) {
      await get().seek(0);
      return;
    }
    const queue = playback.shuffle ? playback.shuffleQueue : playback.queue;
    const prevIndex = Math.max(0, playback.queueIndex - 1);
    if (queue[prevIndex]) {
      await get().openTrack(queue[prevIndex], true);
      set((state) => ({ playback: { ...state.playback, queueIndex: prevIndex } }));
    }
  },

  setDsp: async (patch) => {
    const dsp = cloneDsp(patch, get().dsp);
    set({ dsp });
    await audioEngine.updateDsp(dsp);
  },

  setNestedDsp: async (key, value) => {
    await get().setDsp({ [key]: value } as Partial<DspState>);
  },

  setLoop: async (loop) => {
    set({ loop });
    await audioEngine.updateLoop(loop);
  },

  setLoopPoint: async (point) => {
    const position = get().playback.positionSec;
    const loop = { ...get().loop, enabled: true };
    if (point === 'a') loop.aSec = position;
    else loop.bSec = position;
    if (typeof loop.aSec === 'number' && typeof loop.bSec === 'number' && loop.aSec > loop.bSec) {
      [loop.aSec, loop.bSec] = [loop.bSec, loop.aSec];
    }
    await get().setLoop(loop);
  },

  moveLoop: async (direction, bars = false) => {
    const { loop, currentTrack, dsp } = get();
    if (typeof loop.aSec !== 'number' || typeof loop.bSec !== 'number') return;
    const length = loop.bSec - loop.aSec;
    const bpm = currentTrack?.analysis?.correctedBpm ?? currentTrack?.analysis?.originalBpm;
    const shift = bars && bpm ? (60 / (bpm * (dsp.tempoPercent / 100))) * loop.beatsPerBar : length;
    const nextA = clamp(loop.aSec + shift * direction, 0, Math.max(0, get().playback.durationSec - length));
    await get().setLoop({ ...loop, aSec: nextA, bSec: nextA + length });
  },

  clearLoop: async () => {
    await get().setLoop({ ...defaultLoopState });
  },

  addMarker: async () => {
    const track = get().currentTrack;
    if (!track) return;
    const marker: Marker = {
      id: createId('marker'),
      trackId: track.id,
      timeSec: get().playback.positionSec,
      label: `마커 ${get().markers.length + 1}`,
      color: get().settings.accentColor
    };
    await dbSaveMarker(marker);
    set((state) => ({ markers: [...state.markers, marker].sort((a, b) => a.timeSec - b.timeSec) }));
  },

  deleteMarker: async (id) => {
    await dbDeleteMarker(id);
    set((state) => ({ markers: state.markers.filter((marker) => marker.id !== id) }));
  },

  goToMarker: async (id) => {
    const marker = get().markers.find((item) => item.id === id);
    if (marker) await get().seek(marker.timeSec);
  },

  setRepeatMode: (mode) => set((state) => ({ playback: { ...state.playback, repeatMode: mode } })),

  toggleShuffle: () =>
    set((state) => ({
      playback: {
        ...state.playback,
        shuffle: !state.playback.shuffle,
        shuffleQueue: !state.playback.shuffle ? shuffleIds(state.playback.queue) : []
      }
    })),

  reorderQueue: (from, to) =>
    set((state) => {
      const queue = [...state.playback.queue];
      const [item] = queue.splice(from, 1);
      if (item) queue.splice(to, 0, item);
      return { playback: { ...state.playback, queue, queueIndex: queue.indexOf(state.playback.trackId ?? '') } };
    }),

  removeFromQueue: (trackId) =>
    set((state) => {
      const queue = state.playback.queue.filter((id) => id !== trackId);
      return { playback: { ...state.playback, queue, queueIndex: queue.indexOf(state.playback.trackId ?? '') } };
    }),

  clearQueue: () => set((state) => ({ playback: { ...state.playback, queue: [], queueIndex: -1 } })),

  createPlaylistFromQueue: async (name) => {
    const playlist: Playlist = {
      id: createId('playlist'),
      name,
      trackIds: get().playback.queue,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await dbSavePlaylist(playlist);
    set((state) => ({ playlists: [playlist, ...state.playlists] }));
  },

  savePlaylist: async (playlist) => {
    await dbSavePlaylist({ ...playlist, updatedAt: Date.now() });
    set((state) => ({
      playlists: state.playlists.some((item) => item.id === playlist.id)
        ? state.playlists.map((item) => (item.id === playlist.id ? playlist : item))
        : [playlist, ...state.playlists]
    }));
  },

  deletePlaylist: async (id) => {
    await dbDeletePlaylist(id);
    set((state) => ({ playlists: state.playlists.filter((playlist) => playlist.id !== id) }));
  },

  deleteTrack: async (id) => {
    await dbDeleteTrack(id);
    set((state) => ({
      tracks: state.tracks.filter((track) => track.id !== id),
      playback: {
        ...state.playback,
        queue: state.playback.queue.filter((trackId) => trackId !== id),
        trackId: state.playback.trackId === id ? undefined : state.playback.trackId
      },
      currentTrack: state.currentTrack?.id === id ? undefined : state.currentTrack
    }));
    await get().refreshStorage();
  },

  startAnalysis: async () => {
    const { currentTrack, currentBuffer } = get();
    if (!currentTrack || !currentBuffer) return;
    set({ analysisBusy: true });
    try {
      const analysis = await analyzeBuffer(currentBuffer);
      const updated = { ...currentTrack, analysis };
      await updateTrack(updated);
      set((state) => ({
        currentTrack: updated,
        tracks: state.tracks.map((track) => (track.id === updated.id ? updated : track)),
        analysisBusy: false
      }));
      get().pushToast('success', 'BPM/키 분석을 저장했습니다.');
    } catch {
      set({ analysisBusy: false });
      get().pushToast('error', '분석 중 오류가 발생했습니다.');
    }
  },

  setTrackAnalysis: async (trackId, analysis) => {
    const track = get().tracks.find((item) => item.id === trackId);
    if (!track) return;
    const updated = { ...track, analysis: { ...(track.analysis ?? {}), ...analysis, analyzedAt: Date.now() } };
    await updateTrack(updated);
    set((state) => ({
      tracks: state.tracks.map((item) => (item.id === trackId ? updated : item)),
      currentTrack: state.currentTrack?.id === trackId ? updated : state.currentTrack
    }));
  },

  exportCurrent: async (target, format) => {
    const { currentTrack, currentBuffer, dsp, loop, settings } = get();
    if (!currentTrack || !currentBuffer) return;
    const selectedFormat = format ?? settings.exportFormat;
    const id = createId('export');
    const fileName = createFileName(currentTrack, dsp, selectedFormat);
    set({
      exportJob: {
        id,
        fileName,
        format: selectedFormat,
        target,
        progress: 0,
        phase: '준비',
        status: 'running'
      }
    });
    try {
      const blob = await exportAudioBuffer(currentBuffer, dsp, loop, {
        target,
        format: selectedFormat,
        bitDepth: settings.exportBitDepth,
        mp3Kbps: settings.exportMp3Kbps,
        normalize: dsp.dynamics.normalizeOnExport,
        onProgress: (progress, phase) =>
          set((state) => ({
            exportJob: state.exportJob ? { ...state.exportJob, progress, phase } : state.exportJob
          }))
      });
      const url = downloadBlob(blob, fileName);
      const done: ExportJob = {
        id,
        fileName,
        format: selectedFormat,
        target,
        progress: 1,
        phase: '완료',
        status: 'done',
        url,
        blob
      };
      await saveExportHistory(done);
      set({ exportJob: done });
      get().pushToast('success', '내보내기가 완료되어 다운로드를 시작했습니다.');
    } catch (error) {
      set((state) => ({
        exportJob: state.exportJob
          ? {
              ...state.exportJob,
              status: 'failed',
              error: error instanceof Error ? error.message : '내보내기 실패'
            }
          : undefined
      }));
      get().pushToast('error', '내보내기에 실패했습니다.');
    }
  },

  addExportToLibrary: async () => {
    const job = get().exportJob;
    if (!job?.blob) return;
    const id = createId('track');
    const blobId = createId('blob');
    let durationSec: number;
    let sampleRate: number | undefined;
    let channels: number | undefined;
    try {
      const buffer = await audioEngine.decodeBlob(job.blob);
      durationSec = buffer.duration;
      sampleRate = buffer.sampleRate;
      channels = buffer.numberOfChannels;
    } catch {
      durationSec = get().currentTrack?.durationSec ?? 0;
    }
    const track: Track = {
      id,
      sourceKind: 'export',
      name: job.fileName.replace(/\.[^/.]+$/, ''),
      durationSec,
      sampleRate,
      channels,
      fileSize: job.blob.size,
      mimeType: job.blob.type,
      audioBlobId: blobId,
      importedAt: Date.now()
    };
    await saveTrack(track, job.blob);
    set((state) => ({ tracks: [track, ...state.tracks] }));
    await get().refreshStorage();
    await get().openTrack(track.id, false);
  },

  saveRecording: async (blob, durationSec) => {
    const id = createId('track');
    const blobId = createId('blob');
    let duration = durationSec;
    let sampleRate: number | undefined;
    let channels: number | undefined;
    try {
      const buffer = await audioEngine.decodeBlob(blob);
      duration = duration || buffer.duration;
      sampleRate = buffer.sampleRate;
      channels = buffer.numberOfChannels;
    } catch {
      // Some browsers produce MediaRecorder formats decodeAudioData cannot reopen immediately.
    }
    const track: Track = {
      id,
      sourceKind: 'recording',
      name: `녹음 ${new Date().toLocaleString('ko-KR')}`,
      durationSec: duration,
      sampleRate,
      channels,
      fileSize: blob.size,
      mimeType: blob.type,
      audioBlobId: blobId,
      importedAt: Date.now()
    };
    await saveTrack(track, blob);
    set((state) => ({ tracks: [track, ...state.tracks] }));
    await get().refreshStorage();
    return id;
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await saveSettings(settings);
  },

  refreshStorage: async () => {
    const storage = await estimateStorage();
    set({ storage: { ...storage, label: `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}` } });
  },

  pushToast: (tone, message) => {
    const toast = { id: createId('toast'), tone, message };
    set((state) => ({ toasts: [...state.toasts.slice(-3), toast] }));
    window.setTimeout(() => get().dismissToast(toast.id), 4200);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  setZoom: (zoom) => set({ zoom: clamp(zoom, 1, 16) }),

  handleEnginePosition: (positionSec, durationSec) => {
    set((state) => ({
      playback: {
        ...state.playback,
        positionSec,
        durationSec
      }
    }));
  },

  handleTrackEnd: async () => {
    const { playback } = get();
    if (playback.repeatMode === 'repeat-track') {
      await get().seek(0);
      await get().play();
      return;
    }
    if (playback.repeatMode === 'stop') {
      set((state) => ({ playback: { ...state.playback, isPlaying: false } }));
      return;
    }
    await get().nextTrack();
  }
}));

audioEngine.setCallbacks(
  (position, duration) => useAppStore.getState().handleEnginePosition(position, duration),
  () => {
    void useAppStore.getState().handleTrackEnd();
  }
);

export async function rememberCurrentTrackState(): Promise<void> {
  const state = useAppStore.getState();
  if (!state.currentTrack || !state.settings.rememberPerTrack) return;
  const updated: Track = {
    ...state.currentTrack,
    lastPositionSec: state.playback.positionSec,
    lastPlayedAt: Date.now(),
    remembered: {
      dsp: {
        tempoPercent: state.dsp.tempoPercent,
        pitchSemitones: state.dsp.pitchSemitones,
        joinedRateMode: state.dsp.joinedRateMode,
        formantCorrection: state.dsp.formantCorrection
      },
      loop: state.loop
    }
  };
  await updateTrack(updated);
}

export function getCurrentPitchLabel(dsp: DspState): string {
  const pitch = getEffectivePitch(dsp);
  return `${pitch >= 0 ? '+' : ''}${pitch.toFixed(1)}st`;
}
