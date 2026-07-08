import { useEffect, useMemo, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/plugins/regions';
import ZoomPlugin from 'wavesurfer.js/plugins/zoom';
import {
  Activity,
  AudioLines,
  Bookmark,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Download,
  FastForward,
  FileAudio,
  FolderOpen,
  Library,
  ListMusic,
  Mic,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Rewind,
  Save,
  Search,
  Settings,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X
} from 'lucide-react';
import type { AppSettings, EqBand, Marker, RepeatMode, TabKey, Track } from './types';
import { clearAllData } from './lib/db';
import { defaultDspState } from './lib/defaults';
import { updateMediaSession } from './lib/mediaSession';
import {
  formatBytes,
  formatTime,
  getAdjustedBpm,
  getEffectivePitch,
  keyToCamelot,
  transposeKey,
  updateAnalysisForDisplay
} from './lib/utils';
import { getCurrentPitchLabel, rememberCurrentTrackState, useAppStore } from './store/useAppStore';

type SheetKey = 'eq' | 'effects' | 'analysis' | 'markers' | 'export' | 'record' | 'playlist' | null;

const tabItems: Array<{ key: TabKey; label: string; Icon: typeof Library }> = [
  { key: 'library', label: '라이브러리', Icon: Library },
  { key: 'player', label: '플레이어', Icon: Music2 },
  { key: 'queue', label: '큐', Icon: ListMusic },
  { key: 'settings', label: '설정', Icon: Settings }
];

const repeatLabels: Record<RepeatMode, string> = {
  stop: '정지',
  queue: '이어',
  'repeat-queue': '큐 반복',
  'repeat-track': '한 곡'
};

function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
  className = ''
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`tap focus-ring inline-flex items-center justify-center rounded-md border text-sm transition ${
        active
          ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--text)]'
          : 'border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-[var(--accent)] hover:text-[var(--text)]'} ${className}`}
    >
      {children}
    </button>
  );
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' }) {
  const color =
    tone === 'accent'
      ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] text-[var(--accent)]'
      : tone === 'ok'
        ? 'border-[color-mix(in_srgb,var(--ok)_45%,transparent)] text-[var(--ok)]'
        : tone === 'warn'
          ? 'border-[color-mix(in_srgb,var(--warning)_45%,transparent)] text-[var(--warning)]'
          : 'border-[var(--line)] text-[var(--muted)]';
  return <span className={`rounded-full border px-2 py-1 text-xs ${color}`}>{children}</span>;
}

function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold tracking-normal">{title}</h2>
      {right}
    </div>
  );
}

function Sheet({
  open,
  title,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/55" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" aria-label="닫기" onClick={onClose} />
      <div className="glass safe-bottom relative max-h-[86dvh] w-full overflow-hidden rounded-t-lg shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="닫기" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="thin-scroll max-h-[calc(86dvh-4rem)] overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const initialized = useAppStore((state) => state.initialized);
  const settings = useAppStore((state) => state.settings);
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);
  const currentTrack = useAppStore((state) => state.currentTrack);
  const playback = useAppStore((state) => state.playback);
  const play = useAppStore((state) => state.play);
  const pause = useAppStore((state) => state.pause);
  const previousTrack = useAppStore((state) => state.previousTrack);
  const nextTrack = useAppStore((state) => state.nextTrack);
  const seek = useAppStore((state) => state.seek);
  const [sheet, setSheet] = useState<SheetKey>(null);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty('--accent', settings.accentColor);
    document.documentElement.style.fontSize = `${settings.fontScale * 100}%`;
  }, [settings]);

  useEffect(() => {
    updateMediaSession(currentTrack, playback, {
      play: () => void play(),
      pause: () => void pause(),
      previousTrack: () => void previousTrack(),
      nextTrack: () => void nextTrack(),
      seek: (time) => void seek(time)
    });
  }, [currentTrack, nextTrack, pause, play, playback, previousTrack, seek]);

  useEffect(() => {
    const interval = window.setInterval(() => void rememberCurrentTrackState(), 5000);
    const beforeUnload = () => void rememberCurrentTrackState();
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-3 pb-36 pt-3 sm:px-4">
        <header className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--accent)] text-black">
              <AudioLines size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">TempoWeb</h1>
              <p className="text-xs text-[var(--muted)]">{initialized ? '로컬 처리' : '불러오는 중'}</p>
            </div>
          </div>
          <Pill tone={useAppStore.getState().engineMode === 'signalsmith' ? 'ok' : 'neutral'}>
            {useAppStore.getState().engineMode === 'signalsmith' ? 'WASM' : '대기'}
          </Pill>
        </header>

        <main className="min-h-0 flex-1">
          {activeTab === 'library' && <LibraryView openSheet={setSheet} />}
          {activeTab === 'player' && <PlayerView openSheet={setSheet} />}
          {activeTab === 'queue' && <QueueView openSheet={setSheet} />}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

      <MiniPlayer />
      <BottomTabs activeTab={activeTab} setActiveTab={setActiveTab} />
      <Sheets active={sheet} close={() => setSheet(null)} />

      <div className="fixed right-3 top-3 z-[60] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <button
            type="button"
            key={toast.id}
            onClick={() => dismissToast(toast.id)}
            className={`glass rounded-md px-3 py-2 text-left text-sm shadow-lg ${
              toast.tone === 'error'
                ? 'border-[var(--danger)]'
                : toast.tone === 'success'
                  ? 'border-[var(--ok)]'
                  : toast.tone === 'warning'
                    ? 'border-[var(--warning)]'
                    : ''
            }`}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </div>
  );
}

function LibraryView({ openSheet }: { openSheet: (sheet: SheetKey) => void }) {
  const tracks = useAppStore((state) => state.tracks);
  const importFiles = useAppStore((state) => state.importFiles);
  const openTrack = useAppStore((state) => state.openTrack);
  const deleteTrack = useAppStore((state) => state.deleteTrack);
  const importProgress = useAppStore((state) => state.importProgress);
  const storage = useAppStore((state) => state.storage);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const filtered = useMemo(() => {
    const list = tracks.filter((track) => track.name.toLowerCase().includes(search.toLowerCase()));
    return list.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'ko') : b.importedAt - a.importedAt));
  }, [search, sort, tracks]);

  return (
    <section className="space-y-4">
      <div
        className="glass rounded-lg p-4"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void importFiles(event.dataTransfer.files);
        }}
      >
        <SectionTitle
          title="라이브러리"
          right={<Pill>{tracks.length}곡 · {storage.label}</Pill>}
        />
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            className="tap focus-ring inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-black"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={18} />
            선택
          </button>
          <button
            type="button"
            className="tap focus-ring inline-flex items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm"
            onClick={() => {
              folderInputRef.current?.setAttribute('webkitdirectory', '');
              folderInputRef.current?.click();
            }}
          >
            <FolderOpen size={18} />
            폴더
          </button>
          <button
            type="button"
            className="tap focus-ring inline-flex items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm"
            onClick={() => openSheet('record')}
          >
            <Mic size={18} />
            녹음
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus,.webm"
          multiple
          className="hidden"
          onChange={(event) => event.target.files && void importFiles(event.target.files)}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus,.webm"
          multiple
          className="hidden"
          onChange={(event) => event.target.files && void importFiles(event.target.files)}
        />
      </div>

      {importProgress.some((item) => item.state !== 'done') && (
        <div className="glass rounded-lg p-3">
          <div className="space-y-2">
            {importProgress.map((item) => (
              <div key={item.fileName} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{item.fileName}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">{item.message ?? item.state}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <label className="glass flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2">
          <Search size={18} className="text-[var(--muted)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="검색"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as 'recent' | 'name')}
          className="glass rounded-md px-2 text-sm outline-none"
        >
          <option value="recent">추가순</option>
          <option value="name">이름순</option>
        </select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <EmptyState icon={<FileAudio size={28} />} title="오디오를 선택해 시작하세요" />
        ) : (
          filtered.map((track) => (
            <TrackRow key={track.id} track={track} onOpen={() => void openTrack(track.id, true)} onDelete={() => void deleteTrack(track.id)} />
          ))
        )}
      </div>
    </section>
  );
}

function TrackRow({ track, onOpen, onDelete }: { track: Track; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="glass flex items-center gap-3 rounded-md p-3">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="truncate text-sm font-semibold">{track.name}</div>
        <div className="mt-1 flex flex-wrap gap-1 text-xs text-[var(--muted)]">
          <span>{formatTime(track.durationSec)}</span>
          {track.fileSize ? <span>{formatBytes(track.fileSize)}</span> : null}
          <span>{track.sourceKind === 'recording' ? '녹음' : track.sourceKind === 'export' ? '저장본' : '가져온 곡'}</span>
        </div>
      </button>
      {track.analysis?.originalBpm ? <Pill tone="accent">{Math.round(track.analysis.originalBpm)} BPM</Pill> : null}
      <IconButton label="삭제" onClick={onDelete}>
        <Trash2 size={17} />
      </IconButton>
    </div>
  );
}

function PlayerView({ openSheet }: { openSheet: (sheet: SheetKey) => void }) {
  const currentTrack = useAppStore((state) => state.currentTrack);
  const playback = useAppStore((state) => state.playback);
  const dsp = useAppStore((state) => state.dsp);
  const loop = useAppStore((state) => state.loop);
  const settings = useAppStore((state) => state.settings);
  const togglePlay = useAppStore((state) => state.togglePlay);
  const jump = useAppStore((state) => state.jump);
  const nextTrack = useAppStore((state) => state.nextTrack);
  const previousTrack = useAppStore((state) => state.previousTrack);
  const seek = useAppStore((state) => state.seek);
  const setDsp = useAppStore((state) => state.setDsp);
  const setLoopPoint = useAppStore((state) => state.setLoopPoint);
  const setLoop = useAppStore((state) => state.setLoop);
  const moveLoop = useAppStore((state) => state.moveLoop);
  const addMarker = useAppStore((state) => state.addMarker);
  const setRepeatMode = useAppStore((state) => state.setRepeatMode);
  const toggleShuffle = useAppStore((state) => state.toggleShuffle);
  const engineMode = useAppStore((state) => state.engineMode);

  if (!currentTrack) {
    return <EmptyState icon={<Music2 size={34} />} title="오디오를 선택해 시작하세요" />;
  }

  const displayedAnalysis = updateAnalysisForDisplay(currentTrack, dsp);
  const repeatModes: RepeatMode[] = ['stop', 'queue', 'repeat-queue', 'repeat-track'];
  const nextRepeat = repeatModes[(repeatModes.indexOf(playback.repeatMode) + 1) % repeatModes.length];

  return (
    <section className="space-y-4">
      <div className="glass rounded-lg p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{currentTrack.name}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {displayedAnalysis?.correctedBpm ? <Pill tone="accent">{Math.round(displayedAnalysis.correctedBpm)} BPM</Pill> : null}
              {displayedAnalysis?.key ? <Pill>{displayedAnalysis.key}</Pill> : null}
              {displayedAnalysis?.camelot ? <Pill>{displayedAnalysis.camelot}</Pill> : null}
              <Pill tone={engineMode === 'signalsmith' ? 'ok' : 'warn'}>{engineMode === 'signalsmith' ? 'Signalsmith' : '기본 재생'}</Pill>
            </div>
          </div>
          <IconButton label="분석" onClick={() => openSheet('analysis')}>
            <Wand2 size={18} />
          </IconButton>
        </div>
        <WaveformPanel />
        <div className="mt-3">
          <input
            className="range"
            type="range"
            min={0}
            max={Math.max(1, playback.durationSec)}
            step={0.01}
            value={playback.positionSec}
            onChange={(event) => void seek(Number(event.target.value))}
            aria-label="재생 위치"
          />
          <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
            <span>{formatTime(playback.positionSec)}</span>
            <span>{formatTime(playback.durationSec)}</span>
          </div>
        </div>
      </div>

      <div className="glass rounded-lg p-3">
        <div className="grid grid-cols-7 gap-2">
          <IconButton label={`반복: ${repeatLabels[playback.repeatMode]}`} onClick={() => setRepeatMode(nextRepeat)} active={playback.repeatMode !== 'queue'}>
            {playback.repeatMode === 'repeat-track' ? <Repeat1 size={18} /> : <Repeat size={18} />}
          </IconButton>
          <IconButton label="이전" onClick={() => void previousTrack()}>
            <ChevronsLeft size={18} />
          </IconButton>
          <IconButton label={`-${settings.jumpSeconds}초`} onClick={() => void jump(-settings.jumpSeconds)}>
            <Rewind size={18} />
          </IconButton>
          <button
            type="button"
            aria-label={playback.isPlaying ? '일시정지' : '재생'}
            onClick={() => void togglePlay()}
            className="tap focus-ring grid place-items-center rounded-md bg-[var(--accent)] text-black"
          >
            {playback.isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <IconButton label={`+${settings.jumpSeconds}초`} onClick={() => void jump(settings.jumpSeconds)}>
            <FastForward size={18} />
          </IconButton>
          <IconButton label="다음" onClick={() => void nextTrack()}>
            <ChevronsRight size={18} />
          </IconButton>
          <IconButton label="셔플" onClick={toggleShuffle} active={playback.shuffle}>
            <Shuffle size={18} />
          </IconButton>
        </div>
      </div>

      <div className="glass rounded-lg p-4">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void setDsp({ joinedRateMode: false })}
            className={`tap rounded-md border px-3 text-sm ${!dsp.joinedRateMode ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]' : 'border-[var(--line)]'}`}
          >
            속도/음정
          </button>
          <button
            type="button"
            onClick={() => void setDsp({ joinedRateMode: true })}
            className={`tap rounded-md border px-3 text-sm ${dsp.joinedRateMode ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]' : 'border-[var(--line)]'}`}
          >
            레이트
          </button>
        </div>
        <SliderRow
          label={dsp.joinedRateMode ? '레이트' : '속도'}
          value={dsp.tempoPercent}
          min={settings.tempoMin}
          max={settings.tempoMax}
          step={1}
          suffix="%"
          onChange={(value) => void setDsp({ tempoPercent: value })}
        />
        {!dsp.joinedRateMode && (
          <SliderRow
            label="음정"
            value={dsp.pitchSemitones}
            min={-settings.pitchRange}
            max={settings.pitchRange}
            step={settings.semitoneSnap ? 1 : 0.01}
            suffix="st"
            signed
            onChange={(value) => void setDsp({ pitchSemitones: value })}
          />
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={dsp.formantCorrection}
              onChange={(event) => void setDsp({ formantCorrection: event.target.checked })}
            />
            포먼트 보정
          </label>
          <Pill tone="accent">
            {Math.round(dsp.tempoPercent)}% · {getCurrentPitchLabel(dsp)}
          </Pill>
        </div>
      </div>

      <div className="glass rounded-lg p-3">
        <div className="grid grid-cols-4 gap-2">
          <IconButton label="A 지점" onClick={() => void setLoopPoint('a')} active={typeof loop.aSec === 'number'}>
            A
          </IconButton>
          <IconButton label="B 지점" onClick={() => void setLoopPoint('b')} active={typeof loop.bSec === 'number'}>
            B
          </IconButton>
          <IconButton label="반복 켜기" onClick={() => void setLoop({ ...loop, enabled: !loop.enabled })} active={loop.enabled}>
            <Repeat size={18} />
          </IconButton>
          <IconButton label="마커 추가" onClick={() => void addMarker()}>
            <Bookmark size={18} />
          </IconButton>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <IconButton label="구간 뒤로" onClick={() => void moveLoop(-1)}>
            <ChevronDown className="rotate-90" size={18} />
          </IconButton>
          <IconButton label="구간 앞으로" onClick={() => void moveLoop(1)}>
            <ChevronDown className="-rotate-90" size={18} />
          </IconButton>
          <IconButton label="마디 뒤로" onClick={() => void moveLoop(-1, true)}>
            <Rewind size={18} />
          </IconButton>
          <IconButton label="마디 앞으로" onClick={() => void moveLoop(1, true)}>
            <FastForward size={18} />
          </IconButton>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        <PanelButton label="EQ" icon={<SlidersHorizontal size={18} />} onClick={() => openSheet('eq')} />
        <PanelButton label="효과" icon={<Sparkles size={18} />} onClick={() => openSheet('effects')} />
        <PanelButton label="분석" icon={<Activity size={18} />} onClick={() => openSheet('analysis')} />
        <PanelButton label="마커" icon={<Bookmark size={18} />} onClick={() => openSheet('markers')} />
        <PanelButton label="저장" icon={<Download size={18} />} onClick={() => openSheet('export')} />
      </div>
    </section>
  );
}

function WaveformPanel() {
  const ref = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const currentTrack = useAppStore((state) => state.currentTrack);
  const peaks = useAppStore((state) => state.peaks);
  const playback = useAppStore((state) => state.playback);
  const seek = useAppStore((state) => state.seek);
  const zoom = useAppStore((state) => state.zoom);
  const setZoom = useAppStore((state) => state.setZoom);
  const loop = useAppStore((state) => state.loop);
  const markers = useAppStore((state) => state.markers);

  useEffect(() => {
    if (!ref.current || !currentTrack) return;
    wsRef.current?.destroy();
    const shaped = peaks.length > 0 ? peaks.flatMap((peak) => [-peak, peak]) : [0, 0.02, -0.02, 0];
    const regions = RegionsPlugin.create();
    const zoomPlugin = ZoomPlugin.create({ scale: 0.5, maxZoom: 160 });
    const ws = WaveSurfer.create({
      container: ref.current,
      peaks: [shaped],
      duration: Math.max(0.1, currentTrack.durationSec),
      height: 112,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      interact: true,
      dragToSeek: { debounceTime: 80 },
      cursorWidth: 0,
      waveColor: 'rgba(154,167,183,0.45)',
      progressColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38d5ff',
      plugins: [regions, zoomPlugin]
    });
    ws.on('interaction', (time) => void seek(time));
    wsRef.current = ws;
    return () => ws.destroy();
  }, [currentTrack, peaks, seek]);

  useEffect(() => {
    wsRef.current?.setTime(playback.positionSec);
  }, [playback.positionSec]);

  useEffect(() => {
    wsRef.current?.zoom(32 * zoom);
  }, [zoom]);

  const loopLeft =
    currentTrack && typeof loop.aSec === 'number' ? `${(Math.min(loop.aSec, currentTrack.durationSec) / currentTrack.durationSec) * 100}%` : undefined;
  const loopWidth =
    currentTrack && typeof loop.aSec === 'number' && typeof loop.bSec === 'number'
      ? `${((loop.bSec - loop.aSec) / currentTrack.durationSec) * 100}%`
      : undefined;

  return (
    <div className="relative overflow-hidden rounded-md border border-[var(--line)] bg-[var(--bg-soft)]">
      <div ref={ref} className="min-h-[112px]" />
      {loop.enabled && loopLeft && loopWidth ? (
        <div className="pointer-events-none absolute inset-y-0 border-x border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]" style={{ left: loopLeft, width: loopWidth }} />
      ) : null}
      {markers.map((marker: Marker) => (
        <div
          key={marker.id}
          className="pointer-events-none absolute top-0 h-full w-0.5 bg-[var(--warning)]"
          style={{ left: `${(marker.timeSec / Math.max(1, currentTrack?.durationSec ?? 1)) * 100}%` }}
        />
      ))}
      <div className="absolute bottom-2 right-2 flex gap-1">
        <IconButton label="축소" onClick={() => setZoom(zoom - 1)}>
          -
        </IconButton>
        <IconButton label="확대" onClick={() => setZoom(zoom + 1)}>
          +
        </IconButton>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  signed = false,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  signed?: boolean;
  onChange: (value: number) => void;
}) {
  const display = `${signed && value >= 0 ? '+' : ''}${step < 1 ? value.toFixed(2) : Math.round(value)}${suffix}`;
  return (
    <label className="mb-3 block">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="font-mono text-[var(--text)]">{display}</span>
      </div>
      <input className="range" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function PanelButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="glass tap focus-ring flex flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-xs">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function QueueView({ openSheet }: { openSheet: (sheet: SheetKey) => void }) {
  const tracks = useAppStore((state) => state.tracks);
  const playback = useAppStore((state) => state.playback);
  const openTrack = useAppStore((state) => state.openTrack);
  const removeFromQueue = useAppStore((state) => state.removeFromQueue);
  const clearQueue = useAppStore((state) => state.clearQueue);
  const createPlaylistFromQueue = useAppStore((state) => state.createPlaylistFromQueue);
  const queueTracks = playback.queue.map((id) => tracks.find((track) => track.id === id)).filter(Boolean) as Track[];

  return (
    <section className="space-y-4">
      <div className="glass rounded-lg p-4">
        <SectionTitle
          title="재생 큐"
          right={
            <div className="flex gap-2">
              <IconButton label="플레이리스트" onClick={() => openSheet('playlist')}>
                <Save size={18} />
              </IconButton>
              <IconButton label="비우기" onClick={clearQueue}>
                <Trash2 size={18} />
              </IconButton>
            </div>
          }
        />
        <button
          type="button"
          className="tap focus-ring mb-3 w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-black"
          onClick={() => void createPlaylistFromQueue(`플레이리스트 ${new Date().toLocaleDateString('ko-KR')}`)}
          disabled={queueTracks.length === 0}
        >
          플레이리스트로 저장
        </button>
        <div className="space-y-2">
          {queueTracks.length === 0 ? (
            <EmptyState icon={<ListMusic size={28} />} title="큐가 비어 있습니다" />
          ) : (
            queueTracks.map((track, index) => (
              <div key={`${track.id}_${index}`} className="glass flex items-center gap-3 rounded-md p-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openTrack(track.id, true)}>
                  <div className="truncate text-sm font-semibold">{track.name}</div>
                  <div className="text-xs text-[var(--muted)]">{formatTime(track.durationSec)}</div>
                </button>
                {playback.trackId === track.id ? <Pill tone="accent">재생 중</Pill> : null}
                <IconButton label="제거" onClick={() => removeFromQueue(track.id)}>
                  <X size={17} />
                </IconButton>
              </div>
            ))
          )}
        </div>
      </div>
      <PlaylistList />
    </section>
  );
}

function PlaylistList() {
  const playlists = useAppStore((state) => state.playlists);
  const tracks = useAppStore((state) => state.tracks);
  const deletePlaylist = useAppStore((state) => state.deletePlaylist);
  const openTrack = useAppStore((state) => state.openTrack);
  if (playlists.length === 0) return null;
  return (
    <div className="glass rounded-lg p-4">
      <SectionTitle title="플레이리스트" />
      <div className="space-y-2">
        {playlists.map((playlist) => (
          <div key={playlist.id} className="flex items-center gap-3 rounded-md border border-[var(--line)] p-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => playlist.trackIds[0] && void openTrack(playlist.trackIds[0], true)}
            >
              <div className="truncate text-sm font-semibold">{playlist.name}</div>
              <div className="text-xs text-[var(--muted)]">{playlist.trackIds.filter((id) => tracks.some((track) => track.id === id)).length}곡</div>
            </button>
            <IconButton label="삭제" onClick={() => void deletePlaylist(playlist.id)}>
              <Trash2 size={17} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsView() {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const refreshStorage = useAppStore((state) => state.refreshStorage);
  const storage = useAppStore((state) => state.storage);
  const pushToast = useAppStore((state) => state.pushToast);

  return (
    <section className="space-y-4">
      <div className="glass rounded-lg p-4">
        <SectionTitle title="테마" />
        <div className="grid grid-cols-4 gap-2">
          {(['dark', 'light', 'system', 'amoled'] as AppSettings['theme'][]).map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => void updateSettings({ theme })}
              className={`tap rounded-md border text-sm ${settings.theme === theme ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}
            >
              {theme === 'dark' ? '다크' : theme === 'light' ? '라이트' : theme === 'system' ? '시스템' : 'AMOLED'}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span>액센트</span>
          <input type="color" value={settings.accentColor} onChange={(event) => void updateSettings({ accentColor: event.target.value })} />
        </label>
      </div>

      <div className="glass rounded-lg p-4">
        <SectionTitle title="재생" />
        <SliderRow label="점프" value={settings.jumpSeconds} min={1} max={30} step={1} suffix="초" onChange={(value) => void updateSettings({ jumpSeconds: value })} />
        <SliderRow label="속도 최소" value={settings.tempoMin} min={15} max={100} step={1} suffix="%" onChange={(value) => void updateSettings({ tempoMin: value })} />
        <SliderRow label="속도 최대" value={settings.tempoMax} min={100} max={500} step={1} suffix="%" onChange={(value) => void updateSettings({ tempoMax: value })} />
        <label className="mt-2 flex items-center justify-between text-sm">
          <span>반음 스냅</span>
          <input type="checkbox" checked={settings.semitoneSnap} onChange={(event) => void updateSettings({ semitoneSnap: event.target.checked })} />
        </label>
      </div>

      <div className="glass rounded-lg p-4">
        <SectionTitle title="저장" />
        <div className="grid grid-cols-2 gap-2">
          {(['wav', 'mp3'] as const).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => void updateSettings({ exportFormat: format })}
              className={`tap rounded-md border uppercase ${settings.exportFormat === format ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}
            >
              {format}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center justify-between text-sm">
          <span>트랙별 설정 기억</span>
          <input type="checkbox" checked={settings.rememberPerTrack} onChange={(event) => void updateSettings({ rememberPerTrack: event.target.checked })} />
        </label>
      </div>

      <div className="glass rounded-lg p-4">
        <SectionTitle title="저장 공간" right={<Pill>{storage.label}</Pill>} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="tap rounded-md border border-[var(--line)]" onClick={() => void refreshStorage()}>
            새로고침
          </button>
          <button
            type="button"
            className="tap rounded-md border border-[var(--danger)] text-[var(--danger)]"
            onClick={async () => {
              if (window.confirm('앱 데이터를 모두 삭제할까요?')) {
                await clearAllData();
                pushToast('success', '앱 데이터를 삭제했습니다.');
                window.location.reload();
              }
            }}
          >
            전체 삭제
          </button>
        </div>
      </div>
    </section>
  );
}

function MiniPlayer() {
  const currentTrack = useAppStore((state) => state.currentTrack);
  const playback = useAppStore((state) => state.playback);
  const dsp = useAppStore((state) => state.dsp);
  const togglePlay = useAppStore((state) => state.togglePlay);
  const nextTrack = useAppStore((state) => state.nextTrack);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  return (
    <div className="fixed inset-x-0 bottom-[68px] z-30 mx-auto w-full max-w-[720px] px-3">
      <div className="glass flex items-center gap-3 rounded-lg p-2 shadow-lg">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setActiveTab('player')}>
          <div className="truncate text-sm font-semibold">{currentTrack?.name ?? '오디오를 선택하세요'}</div>
          <div className="mt-1 flex gap-2 text-xs text-[var(--muted)]">
            <span>{formatTime(playback.positionSec)}</span>
            <span>{Math.round(dsp.tempoPercent)}%</span>
            <span>{getCurrentPitchLabel(dsp)}</span>
          </div>
        </button>
        <IconButton label={playback.isPlaying ? '일시정지' : '재생'} onClick={() => void togglePlay()} disabled={!currentTrack}>
          {playback.isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </IconButton>
        <IconButton label="다음" onClick={() => void nextTrack()} disabled={!currentTrack}>
          <ChevronsRight size={18} />
        </IconButton>
      </div>
    </div>
  );
}

function BottomTabs({ activeTab, setActiveTab }: { activeTab: TabKey; setActiveTab: (tab: TabKey) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_96%,transparent)] backdrop-blur">
      <div className="safe-bottom mx-auto grid max-w-[720px] grid-cols-4 gap-1 px-2 pt-2">
        {tabItems.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`tap focus-ring flex flex-col items-center justify-center rounded-md px-2 py-1 text-xs ${
              activeTab === key ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
            }`}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function Sheets({ active, close }: { active: SheetKey; close: () => void }) {
  return (
    <>
      <Sheet open={active === 'eq'} title="EQ" onClose={close}>
        <EqSheet />
      </Sheet>
      <Sheet open={active === 'effects'} title="효과" onClose={close}>
        <EffectsSheet />
      </Sheet>
      <Sheet open={active === 'analysis'} title="분석" onClose={close}>
        <AnalysisSheet />
      </Sheet>
      <Sheet open={active === 'markers'} title="마커" onClose={close}>
        <MarkersSheet />
      </Sheet>
      <Sheet open={active === 'export'} title="저장" onClose={close}>
        <ExportSheet />
      </Sheet>
      <Sheet open={active === 'record'} title="녹음" onClose={close}>
        <RecordingSheet close={close} />
      </Sheet>
      <Sheet open={active === 'playlist'} title="플레이리스트" onClose={close}>
        <PlaylistList />
      </Sheet>
    </>
  );
}

function EqSheet() {
  const dsp = useAppStore((state) => state.dsp);
  const setDsp = useAppStore((state) => state.setDsp);
  const updateBand = (index: number, patch: Partial<EqBand>) => {
    const bands = dsp.eq.bands.map((band, i) => (i === index ? { ...band, ...patch } : band));
    void setDsp({ eq: { ...dsp.eq, bands } });
  };
  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between text-sm">
        <span>EQ</span>
        <input type="checkbox" checked={dsp.eq.enabled} onChange={(event) => void setDsp({ eq: { ...dsp.eq, enabled: event.target.checked } })} />
      </label>
      <SliderRow label="프리앰프" value={dsp.preampDb} min={-24} max={12} step={0.5} suffix="dB" signed onChange={(value) => void setDsp({ preampDb: value })} />
      <SliderRow label="밸런스" value={dsp.balance} min={-1} max={1} step={0.01} suffix="" signed onChange={(value) => void setDsp({ balance: value })} />
      <div className="space-y-3">
        {dsp.eq.bands.map((band, index) => (
          <SliderRow
            key={band.freq}
            label={`${band.freq >= 1000 ? `${band.freq / 1000}k` : band.freq}Hz`}
            value={band.gainDb}
            min={-12}
            max={12}
            step={0.5}
            suffix="dB"
            signed
            onChange={(value) => updateBand(index, { gainDb: value })}
          />
        ))}
      </div>
      <button type="button" className="tap w-full rounded-md border border-[var(--line)]" onClick={() => void setDsp({ eq: defaultDspState.eq, preampDb: -3, balance: 0 })}>
        초기화
      </button>
    </div>
  );
}

function EffectsSheet() {
  const dsp = useAppStore((state) => state.dsp);
  const setDsp = useAppStore((state) => state.setDsp);
  const effects = dsp.effects;
  const dynamics = dsp.dynamics;
  return (
    <div className="space-y-5">
      <SliderRow label="보컬 줄이기" value={effects.vocalReduction} min={0} max={1} step={0.01} suffix="" onChange={(value) => void setDsp({ effects: { ...effects, vocalReduction: value } })} />
      <ToggleBlock label="에코" checked={effects.echoEnabled} onChange={(checked) => void setDsp({ effects: { ...effects, echoEnabled: checked } })}>
        <SliderRow label="믹스" value={effects.echoMix} min={0} max={0.8} step={0.01} suffix="" onChange={(value) => void setDsp({ effects: { ...effects, echoMix: value } })} />
        <SliderRow label="피드백" value={effects.echoFeedback} min={0} max={0.85} step={0.01} suffix="" onChange={(value) => void setDsp({ effects: { ...effects, echoFeedback: value } })} />
        <SliderRow label="딜레이" value={effects.echoDelayMs} min={40} max={1200} step={5} suffix="ms" onChange={(value) => void setDsp({ effects: { ...effects, echoDelayMs: value } })} />
      </ToggleBlock>
      <ToggleBlock label="플랜저" checked={effects.flangerEnabled} onChange={(checked) => void setDsp({ effects: { ...effects, flangerEnabled: checked } })}>
        <SliderRow label="깊이" value={effects.flangerDepthMs} min={0} max={12} step={0.1} suffix="ms" onChange={(value) => void setDsp({ effects: { ...effects, flangerDepthMs: value } })} />
        <SliderRow label="속도" value={effects.flangerRateHz} min={0.05} max={2} step={0.01} suffix="Hz" onChange={(value) => void setDsp({ effects: { ...effects, flangerRateHz: value } })} />
      </ToggleBlock>
      <ToggleBlock label="리버브" checked={effects.reverbEnabled} onChange={(checked) => void setDsp({ effects: { ...effects, reverbEnabled: checked } })}>
        <SliderRow label="믹스" value={effects.reverbMix} min={0} max={0.8} step={0.01} suffix="" onChange={(value) => void setDsp({ effects: { ...effects, reverbMix: value } })} />
        <SliderRow label="길이" value={effects.reverbSeconds} min={0.2} max={5} step={0.1} suffix="s" onChange={(value) => void setDsp({ effects: { ...effects, reverbSeconds: value } })} />
      </ToggleBlock>
      <ToggleBlock label="컴프레서" checked={dynamics.compressorEnabled} onChange={(checked) => void setDsp({ dynamics: { ...dynamics, compressorEnabled: checked } })}>
        <SliderRow label="스레숄드" value={dynamics.thresholdDb} min={-60} max={0} step={1} suffix="dB" signed onChange={(value) => void setDsp({ dynamics: { ...dynamics, thresholdDb: value } })} />
        <SliderRow label="비율" value={dynamics.ratio} min={1} max={20} step={0.5} suffix=":1" onChange={(value) => void setDsp({ dynamics: { ...dynamics, ratio: value } })} />
      </ToggleBlock>
      <label className="flex items-center justify-between text-sm">
        <span>리미터</span>
        <input type="checkbox" checked={dynamics.limiterEnabled} onChange={(event) => void setDsp({ dynamics: { ...dynamics, limiterEnabled: event.target.checked } })} />
      </label>
    </div>
  );
}

function ToggleBlock({
  label,
  checked,
  onChange,
  children
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] p-3">
      <label className="mb-3 flex items-center justify-between text-sm font-semibold">
        <span>{label}</span>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      </label>
      {children}
    </div>
  );
}

function AnalysisSheet() {
  const currentTrack = useAppStore((state) => state.currentTrack);
  const dsp = useAppStore((state) => state.dsp);
  const analysisBusy = useAppStore((state) => state.analysisBusy);
  const startAnalysis = useAppStore((state) => state.startAnalysis);
  const setTrackAnalysis = useAppStore((state) => state.setTrackAnalysis);
  if (!currentTrack) return <EmptyState icon={<Activity size={28} />} title="열린 곡이 없습니다" />;
  const originalBpm = currentTrack.analysis?.correctedBpm ?? currentTrack.analysis?.originalBpm;
  const adjustedBpm = getAdjustedBpm(currentTrack, dsp);
  const adjustedKey = transposeKey(currentTrack.analysis?.key, getEffectivePitch(dsp));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="원본 BPM" value={originalBpm ? Math.round(originalBpm).toString() : '-'} />
        <Metric label="조정 후 BPM" value={adjustedBpm ? Math.round(adjustedBpm).toString() : '-'} />
        <Metric label="원본 키" value={currentTrack.analysis?.key ?? '-'} />
        <Metric label="조정 후 키" value={adjustedKey ?? '-'} />
        <Metric label="Camelot" value={keyToCamelot(adjustedKey) ?? '-'} />
        <Metric label="신뢰도" value={currentTrack.analysis?.confidence ? `${Math.round(currentTrack.analysis.confidence * 100)}%` : '-'} />
      </div>
      <button type="button" className="tap w-full rounded-md bg-[var(--accent)] font-semibold text-black" onClick={() => void startAnalysis()} disabled={analysisBusy}>
        {analysisBusy ? '분석 중' : '다시 분석'}
      </button>
      {originalBpm ? (
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className="tap rounded-md border border-[var(--line)]" onClick={() => void setTrackAnalysis(currentTrack.id, { correctedBpm: originalBpm / 2 })}>
            x1/2
          </button>
          <button type="button" className="tap rounded-md border border-[var(--line)]" onClick={() => void setTrackAnalysis(currentTrack.id, { correctedBpm: currentTrack.analysis?.originalBpm })}>
            원본
          </button>
          <button type="button" className="tap rounded-md border border-[var(--line)]" onClick={() => void setTrackAnalysis(currentTrack.id, { correctedBpm: originalBpm * 2 })}>
            x2
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function MarkersSheet() {
  const markers = useAppStore((state) => state.markers);
  const goToMarker = useAppStore((state) => state.goToMarker);
  const deleteMarker = useAppStore((state) => state.deleteMarker);
  const addMarker = useAppStore((state) => state.addMarker);
  return (
    <div className="space-y-3">
      <button type="button" className="tap w-full rounded-md bg-[var(--accent)] font-semibold text-black" onClick={() => void addMarker()}>
        현재 위치에 마커
      </button>
      {markers.length === 0 ? (
        <EmptyState icon={<Bookmark size={28} />} title="마커가 없습니다" />
      ) : (
        markers.map((marker) => (
          <div key={marker.id} className="flex items-center gap-3 rounded-md border border-[var(--line)] p-3">
            <button type="button" className="flex-1 text-left" onClick={() => void goToMarker(marker.id)}>
              <div className="font-semibold">{marker.label}</div>
              <div className="text-xs text-[var(--muted)]">{formatTime(marker.timeSec)}</div>
            </button>
            <IconButton label="삭제" onClick={() => void deleteMarker(marker.id)}>
              <Trash2 size={17} />
            </IconButton>
          </div>
        ))
      )}
    </div>
  );
}

function ExportSheet() {
  const exportCurrent = useAppStore((state) => state.exportCurrent);
  const addExportToLibrary = useAppStore((state) => state.addExportToLibrary);
  const exportJob = useAppStore((state) => state.exportJob);
  const settings = useAppStore((state) => state.settings);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="tap rounded-md bg-[var(--accent)] font-semibold text-black" onClick={() => void exportCurrent('full', settings.exportFormat)}>
          전체 저장
        </button>
        <button type="button" className="tap rounded-md border border-[var(--line)]" onClick={() => void exportCurrent('loop', settings.exportFormat)}>
          구간 저장
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="tap rounded-md border border-[var(--line)] uppercase" onClick={() => void exportCurrent('full', 'wav')}>
          WAV
        </button>
        <button type="button" className="tap rounded-md border border-[var(--line)] uppercase" onClick={() => void exportCurrent('full', 'mp3')}>
          MP3
        </button>
      </div>
      {exportJob ? (
        <div className="rounded-md border border-[var(--line)] p-3">
          <div className="mb-2 flex justify-between text-sm">
            <span>{exportJob.phase}</span>
            <span>{Math.round(exportJob.progress * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${exportJob.progress * 100}%` }} />
          </div>
          {exportJob.status === 'done' ? (
            <button type="button" className="tap mt-3 w-full rounded-md border border-[var(--line)]" onClick={() => void addExportToLibrary()}>
              라이브러리에 추가
            </button>
          ) : null}
          {exportJob.error ? <p className="mt-2 text-sm text-[var(--danger)]">{exportJob.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function RecordingSheet({ close }: { close: () => void }) {
  const saveRecording = useAppStore((state) => state.saveRecording);
  const openTrack = useAppStore((state) => state.openTrack);
  const pushToast = useAppStore((state) => state.pushToast);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (recording && startedAt) setElapsed((Date.now() - startedAt) / 1000);
      if (analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(data);
        let peak = 0;
        data.forEach((value) => (peak = Math.max(peak, Math.abs(value - 128) / 128)));
        setLevel(peak);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording, startedAt]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      source.connect(analyser);
      analyserRef.current = analyser;
      const mediaRecorder = new MediaRecorder(stream);
      const nextChunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) nextChunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        setChunks(nextChunks);
        setRecording(false);
      };
      mediaRecorder.start();
      setRecorder(mediaRecorder);
      setStartedAt(Date.now());
      setElapsed(0);
      setRecording(true);
    } catch {
      pushToast('error', '마이크 권한을 받을 수 없습니다.');
    }
  };

  const stop = () => {
    recorder?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  };

  const save = async () => {
    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    const id = await saveRecording(blob, elapsed);
    await openTrack(id, false);
    close();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[var(--line)] p-4 text-center">
        <div className="text-3xl font-semibold">{formatTime(elapsed)}</div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div className={`h-full ${level > 0.92 ? 'bg-[var(--danger)]' : 'bg-[var(--accent)]'}`} style={{ width: `${Math.min(100, level * 100)}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" className="tap rounded-md bg-[var(--accent)] font-semibold text-black" onClick={() => void start()} disabled={recording}>
          시작
        </button>
        <button type="button" className="tap rounded-md border border-[var(--line)]" onClick={stop} disabled={!recording}>
          정지
        </button>
        <button type="button" className="tap rounded-md border border-[var(--line)]" onClick={() => void save()} disabled={chunks.length === 0}>
          저장
        </button>
      </div>
    </div>
  );
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="glass grid min-h-[12rem] place-items-center rounded-lg p-6 text-center text-[var(--muted)]">
      <div>
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-lg border border-[var(--line)]">{icon}</div>
        <p className="text-sm">{title}</p>
      </div>
    </div>
  );
}

export default App;
