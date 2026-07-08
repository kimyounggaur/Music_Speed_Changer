import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppSettings, ExportJob, ID, Marker, Playlist, Track } from '../types';
import { defaultSettings } from './defaults';

interface BlobRecord {
  id: ID;
  blob: Blob;
  createdAt: number;
}

interface PeaksRecord {
  trackId: ID;
  peaks: number[];
  resolution: number;
  createdAt: number;
}

interface SettingRecord {
  key: string;
  value: unknown;
}

interface TempoWebDB extends DBSchema {
  tracks: {
    key: ID;
    value: Track;
    indexes: {
      'by-importedAt': number;
      'by-sourceKind': string;
    };
  };
  blobs: {
    key: ID;
    value: BlobRecord;
  };
  peaks: {
    key: ID;
    value: PeaksRecord;
  };
  markers: {
    key: ID;
    value: Marker;
    indexes: {
      'by-trackId': ID;
    };
  };
  playlists: {
    key: ID;
    value: Playlist;
  };
  settings: {
    key: string;
    value: SettingRecord;
  };
  exports: {
    key: ID;
    value: ExportJob;
  };
}

let dbPromise: Promise<IDBPDatabase<TempoWebDB>> | undefined;

function getDb(): Promise<IDBPDatabase<TempoWebDB>> {
  dbPromise ??= openDB<TempoWebDB>('tempoweb', 1, {
    upgrade(db) {
      const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
      tracks.createIndex('by-importedAt', 'importedAt');
      tracks.createIndex('by-sourceKind', 'sourceKind');
      db.createObjectStore('blobs', { keyPath: 'id' });
      db.createObjectStore('peaks', { keyPath: 'trackId' });
      const markers = db.createObjectStore('markers', { keyPath: 'id' });
      markers.createIndex('by-trackId', 'trackId');
      db.createObjectStore('playlists', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'key' });
      db.createObjectStore('exports', { keyPath: 'id' });
    }
  });
  return dbPromise;
}

export async function saveTrack(track: Track, blob: Blob): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['tracks', 'blobs'], 'readwrite');
  await Promise.all([
    tx.objectStore('blobs').put({ id: track.audioBlobId, blob, createdAt: Date.now() }),
    tx.objectStore('tracks').put(track),
    tx.done
  ]);
}

export async function updateTrack(track: Track): Promise<void> {
  const db = await getDb();
  await db.put('tracks', track);
}

export async function getTracks(): Promise<Track[]> {
  const db = await getDb();
  const tracks = await db.getAll('tracks');
  return tracks.sort((a, b) => b.importedAt - a.importedAt);
}

export async function getTrack(id: ID): Promise<Track | undefined> {
  const db = await getDb();
  return db.get('tracks', id);
}

export async function getAudioBlob(id: ID): Promise<Blob | undefined> {
  const db = await getDb();
  return (await db.get('blobs', id))?.blob;
}

export async function deleteTrack(id: ID): Promise<void> {
  const db = await getDb();
  const track = await db.get('tracks', id);
  const tx = db.transaction(['tracks', 'blobs', 'peaks', 'markers'], 'readwrite');
  tx.objectStore('tracks').delete(id);
  tx.objectStore('peaks').delete(id);
  if (track) tx.objectStore('blobs').delete(track.audioBlobId);
  const markerIndex = tx.objectStore('markers').index('by-trackId');
  const markerKeys = await markerIndex.getAllKeys(id);
  markerKeys.forEach((key) => tx.objectStore('markers').delete(key));
  await tx.done;
}

export async function savePeaks(trackId: ID, peaks: number[], resolution: number): Promise<void> {
  const db = await getDb();
  await db.put('peaks', { trackId, peaks, resolution, createdAt: Date.now() });
}

export async function getPeaks(trackId: ID): Promise<PeaksRecord | undefined> {
  const db = await getDb();
  return db.get('peaks', trackId);
}

export async function getMarkers(trackId: ID): Promise<Marker[]> {
  const db = await getDb();
  return (await db.getAllFromIndex('markers', 'by-trackId', trackId)).sort((a, b) => a.timeSec - b.timeSec);
}

export async function saveMarker(marker: Marker): Promise<void> {
  const db = await getDb();
  await db.put('markers', marker);
}

export async function deleteMarker(id: ID): Promise<void> {
  const db = await getDb();
  await db.delete('markers', id);
}

export async function getPlaylists(): Promise<Playlist[]> {
  const db = await getDb();
  return (await db.getAll('playlists')).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function savePlaylist(playlist: Playlist): Promise<void> {
  const db = await getDb();
  await db.put('playlists', playlist);
}

export async function deletePlaylist(id: ID): Promise<void> {
  const db = await getDb();
  await db.delete('playlists', id);
}

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const record = await db.get('settings', 'app');
  return { ...defaultSettings, ...((record?.value as Partial<AppSettings> | undefined) ?? {}) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  await db.put('settings', { key: 'app', value: settings });
}

export async function saveExportHistory(job: ExportJob): Promise<void> {
  const db = await getDb();
  const safeJob = { ...job, url: undefined };
  await db.put('exports', safeJob);
}

export async function getExportHistory(): Promise<ExportJob[]> {
  const db = await getDb();
  return (await db.getAll('exports')).slice(-20).reverse();
}

export async function estimateStorage(): Promise<{ usage: number; quota: number }> {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0 };
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['tracks', 'blobs', 'peaks', 'markers', 'playlists', 'settings', 'exports'], 'readwrite');
  await Promise.all([
    tx.objectStore('tracks').clear(),
    tx.objectStore('blobs').clear(),
    tx.objectStore('peaks').clear(),
    tx.objectStore('markers').clear(),
    tx.objectStore('playlists').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('exports').clear(),
    tx.done
  ]);
}
