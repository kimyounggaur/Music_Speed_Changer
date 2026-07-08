import type { Track } from '../types';
import { formatTime } from './utils';

export function updateMediaSession(
  track: Track | undefined,
  playback: { positionSec: number; durationSec: number; isPlaying: boolean },
  handlers: {
    play: () => void;
    pause: () => void;
    previousTrack: () => void;
    nextTrack: () => void;
    seek: (time: number) => void;
  }
): void {
  if (!('mediaSession' in navigator)) return;
  if (track) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || track.name,
      artist: track.artist || 'TempoWeb',
      album: '로컬 라이브러리'
    });
  }
  navigator.mediaSession.playbackState = playback.isPlaying ? 'playing' : 'paused';
  navigator.mediaSession.setActionHandler('play', handlers.play);
  navigator.mediaSession.setActionHandler('pause', handlers.pause);
  navigator.mediaSession.setActionHandler('previoustrack', handlers.previousTrack);
  navigator.mediaSession.setActionHandler('nexttrack', handlers.nextTrack);
  navigator.mediaSession.setActionHandler('seekbackward', () => handlers.seek(Math.max(0, playback.positionSec - 5)));
  navigator.mediaSession.setActionHandler('seekforward', () =>
    handlers.seek(Math.min(playback.durationSec, playback.positionSec + 5))
  );
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (typeof details.seekTime === 'number') handlers.seek(details.seekTime);
  });
  try {
    navigator.mediaSession.setPositionState({
      duration: Math.max(1, playback.durationSec),
      position: Math.min(playback.positionSec, Math.max(1, playback.durationSec)),
      playbackRate: 1
    });
  } catch {
    document.title = track ? `${track.name} · ${formatTime(playback.positionSec)}` : 'TempoWeb';
  }
}
