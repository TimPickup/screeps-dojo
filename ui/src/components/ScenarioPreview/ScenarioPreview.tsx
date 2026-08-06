import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { drawStaticScene } from '../../canvas/staticLayers';
import type { ScenarioPreviewScene } from '../../render/scenarioPreview';
import { buildScenarioPreviewScene } from '../../render/scenarioPreview';
import { useRenderFonts } from '../../hooks/useRenderFonts';
import { useTerrainTexture } from '../../hooks/useTerrainTexture';
import styles from './ScenarioPreview.module.css';

interface CachedPreview {
  revision: string;
  scene: ScenarioPreviewScene | null;
}

// The HTTP response is ETag-revalidated by the browser. This second, small
// cache avoids reparsing the same maps into a frame when tabs are switched.
const sceneCache = new Map<string, CachedPreview>();
const SCENE_CACHE_LIMIT = 4;

function cachedScene(scenario: string): CachedPreview | undefined {
  const cached = sceneCache.get(scenario);
  if (!cached) return undefined;
  sceneCache.delete(scenario);
  sceneCache.set(scenario, cached);
  return cached;
}

function cacheScene(scenario: string, cached: CachedPreview): void {
  sceneCache.set(scenario, cached);
  while (sceneCache.size > SCENE_CACHE_LIMIT) {
    const oldest = sceneCache.keys().next().value;
    if (oldest === undefined) break;
    sceneCache.delete(oldest);
  }
}

export function ScenarioPreview({ scenario }: { scenario: string }) {
  const fontsReady = useRenderFonts();
  const terrainTexture = useTerrainTexture();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scene, setScene] = useState<ScenarioPreviewScene | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setScene(null);
    setLoadError(null);
    setFileErrors(0);
    api.maps(scenario).then((response) => {
      if (cancelled) return;
      let cached = cachedScene(scenario);
      if (!cached || cached.revision !== response.revision) {
        cached = { revision: response.revision, scene: buildScenarioPreviewScene(response.maps) };
        cacheScene(scenario, cached);
      }
      setScene(cached.scene);
      setFileErrors(response.errors.length + (cached.scene?.errors.length || 0));
    }).catch((error) => {
      if (!cancelled) {
        setScene(null);
        setLoadError(String((error as Error).message || error));
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scenario]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas || !scene || !fontsReady || !terrainTexture) return;
    let raf = 0;
    const render = () => {
      raf = 0;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0e0e0e';
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);

      const cols = scene.layout.width / scene.layout.pixelsPerRoom;
      const rows = scene.layout.height / scene.layout.pixelsPerRoom;
      const worldWidth = Math.max(50, cols * 50);
      const worldHeight = Math.max(50, rows * 50);
      const padding = Math.min(20, width * 0.02, height * 0.02);
      const scale = Math.max(0.001, Math.min(
        (width - padding * 2) / worldWidth,
        (height - padding * 2) / worldHeight,
      ));
      const tx = (width - worldWidth * scale) / 2;
      const ty = (height - worldHeight * scale) / 2;
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, tx * dpr, ty * dpr);
      drawStaticScene(ctx, scene, { initialSourceEnergy: true, terrainTexture });
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(render);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    schedule();
    return () => { observer.disconnect(); if (raf) window.cancelAnimationFrame(raf); };
  }, [scene, fontsReady, terrainTexture]);

  const roomCount = scene ? Object.keys(scene.terrain).length : 0;
  const duplicateCount = scene?.duplicateRooms.length || 0;
  const label = roomCount ? `${roomCount} room scenario map preview` : 'Scenario map preview unavailable';

  return (
    <div ref={hostRef} className={styles.preview} role="img" aria-label={label}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      {loading && <div className={styles.message}>loading map preview…</div>}
      {!loading && !scene && <div className={styles.message}>{loadError ? 'preview unavailable' : 'no valid map preview'}</div>}
      {scene && <div className={styles.meta}>preview · {roomCount} {roomCount === 1 ? 'room' : 'rooms'}</div>}
      {scene && (fileErrors > 0 || duplicateCount > 0) && (
        <div className={styles.warning} title={scene.duplicateRooms.length ? `Duplicate rooms: ${scene.duplicateRooms.join(', ')}` : undefined}>
          {fileErrors > 0 ? `${fileErrors} map ${fileErrors === 1 ? 'file' : 'files'} skipped` : ''}
          {fileErrors > 0 && duplicateCount > 0 ? ' · ' : ''}
          {duplicateCount > 0 ? `${duplicateCount} duplicate ${duplicateCount === 1 ? 'room' : 'rooms'}` : ''}
        </div>
      )}
    </div>
  );
}
