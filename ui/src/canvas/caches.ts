import type { Frame, Recording, StageLayout } from '../api/types.ts';
import { buildTerrainCanvas, buildStructureCanvas, STATIC_RES, type CanvasFactory } from './staticLayers.ts';
import { populateFrameMy } from './ownership.ts';

// ---- Per-epoch static-scene background cache ----
// Epoch = a run of frames with the same structure layout. Key excludes
// energy/progress (those would change every tick); minor in-epoch staleness of
// energy fills is accepted by the cached static layer.
const STRUCT_TYPES = new Set(['spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab',
  'factory', 'observer', 'nuker', 'powerSpawn', 'container', 'road', 'rampart', 'constructedWall',
  'controller', 'invaderCore', 'keeperLair', 'extractor', 'source', 'mineral', 'constructionSite']);

export function epochKey(frame: Frame): string {
  const parts: string[] = [];
  for (const o of frame.objects) {
    if (!STRUCT_TYPES.has(o.type)) continue;
    parts.push(o.type + ',' + o.room + ',' + o.x + ',' + o.y + ',' + (o.level ?? '') + ',' + (o.user ?? ''));
  }
  for (const flag of frame.flags || []) parts.push('flag,' + JSON.stringify(flag));
  parts.sort();
  return parts.join('|');
}

export class StaticLayers {
  terrain: HTMLCanvasElement;
  structure: HTMLCanvasElement;
  private key: string;
  private layout: StageLayout;
  private res: number;
  private canvasFactory?: CanvasFactory;
  private botUserId?: string;

  constructor(recording: Recording, layout: StageLayout, res = STATIC_RES, canvasFactory?: CanvasFactory) {
    this.layout = layout;
    this.res = res;
    this.canvasFactory = canvasFactory;
    this.botUserId = recording.meta.botUserId;
    this.terrain = buildTerrainCanvas(recording, layout, res, canvasFactory);
    const first = recording.frames[0];
    this.prepare(first);
    this.key = epochKey(first);
    this.structure = buildStructureCanvas(first, layout, res, canvasFactory);
  }

  prepare(frame: Frame): void {
    populateFrameMy(frame, this.botUserId);
  }

  // Rebuild the structure layer only when the structure set changes.
  sync(frame: Frame): void {
    this.prepare(frame);
    const k = epochKey(frame);
    if (k !== this.key) {
      this.key = k;
      this.structure = buildStructureCanvas(frame, this.layout, this.res, this.canvasFactory);
    }
  }
}
