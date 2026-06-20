import type { Frame, FrameObject, Recording, StageLayout } from '../api/types';
import { generateCreepSvg, countBodyParts } from '../render/creepSprite';
import { INVADER_INNER, INVADER_VIEWBOX } from '../render/invaderAsset';
import { svgToImage } from './rasterize';

const NPC_USERS = new Set(['2', '3']);
const CREEP_SIZE_TILES = 1.25;
const SPRITE_PX = 96; // rasterization resolution per creep sprite (crisp to ~3x zoom)
const STORE_BUCKETS = 8;

// ---- Creep + invader sprite cache (rasterized from the exact SVG generator) ----
// Sprites are rasterized centred in a CREEP_SIZE_TILES box (in tile units) and
// drawn at world tile coords; rotation is applied at draw time, not baked.
export class SpriteCache {
  private creeps = new Map<string, HTMLImageElement>();
  private invader: HTMLImageElement | null = null;
  private botUserId?: string;

  constructor(botUserId?: string) { this.botUserId = botUserId; }

  private key(o: FrameObject): string {
    const counts = countBodyParts(o.body);
    const body = Object.keys(counts).sort().map((k) => k + counts[k]).join('');
    const owner = o.user === this.botUserId ? 'me' : (NPC_USERS.has(String(o.user)) ? 'npc' : 'enemy');
    const store = o.store || {};
    let used = 0; for (const r of Object.keys(store)) used += store[r];
    const cap = (o.storeCapacity as number) || 0;
    const bucket = cap > 0 ? Math.round(Math.min(1, used / cap) * STORE_BUCKETS) : (used > 0 ? STORE_BUCKETS : 0);
    const onlyEnergy = Object.keys(store).filter((r) => store[r] > 0).every((r) => r === 'energy');
    return owner + '|' + body + '|' + bucket + '|' + (onlyEnergy ? 'e' : 'x');
  }

  // Pre-rasterize every distinct creep appearance + the invader, so the first
  // frame paints with all creeps present (no pop-in). Resolves when ready.
  async prewarm(recording: Recording): Promise<void> {
    const jobs: Promise<void>[] = [];
    const seen = new Set<string>();
    for (const frame of recording.frames) {
      for (const o of frame.objects) {
        if (o.type !== 'creep' || o.spawning) continue;
        if (NPC_USERS.has(String(o.user))) continue; // invader handled separately
        const k = this.key(o);
        if (seen.has(k)) continue;
        seen.add(k);
        jobs.push(this.rasterizeCreep(k, o));
      }
    }
    jobs.push(this.rasterizeInvader());
    await Promise.all(jobs);
  }

  private async rasterizeCreep(key: string, o: FrameObject): Promise<void> {
    const counts = countBodyParts(o.body);
    const inner = o.user === this.botUserId ? '#5577ff' : '#ff5555';
    const S = CREEP_SIZE_TILES;
    const inner_svg = generateCreepSvg(S / 2, S / 2, S, counts, o.store, 1, inner, o.storeCapacity as number);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + SPRITE_PX + '" height="' + SPRITE_PX + '" viewBox="0 0 ' + S + ' ' + S + '">' + inner_svg + '</svg>';
    try { this.creeps.set(key, await svgToImage(svg)); } catch (e) { /* skip */ }
  }

  private async rasterizeInvader(): Promise<void> {
    const size = 0.95; // tiles (matches frameRenderer)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + SPRITE_PX + '" height="' + SPRITE_PX + '" viewBox="0 0 ' + INVADER_VIEWBOX.width + ' ' + INVADER_VIEWBOX.height + '">' + INVADER_INNER + '</svg>';
    try { this.invader = await svgToImage(svg); } catch (e) { /* skip */ }
    void size;
  }

  creepSprite(o: FrameObject): HTMLImageElement | null { return this.creeps.get(this.key(o)) || null; }
  invaderSprite(): HTMLImageElement | null { return this.invader; }
  isBot(o: FrameObject): boolean { return !!this.botUserId && o.user === this.botUserId; }
  isNpc(o: FrameObject): boolean { return NPC_USERS.has(String(o.user)); }
}

// ---- Per-epoch static-scene background cache ----
// Epoch = a run of frames with the same structure layout. Key excludes
// energy/progress (those would change every tick); minor in-epoch staleness of
// energy fills is accepted (SVG mode is exact).
const STRUCT_TYPES = new Set(['spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab',
  'factory', 'observer', 'nuker', 'powerSpawn', 'container', 'road', 'rampart', 'constructedWall',
  'controller', 'invaderCore', 'keeperLair', 'extractor', 'source', 'mineral']);

export function epochKey(frame: Frame): string {
  const parts: string[] = [];
  for (const o of frame.objects) {
    if (!STRUCT_TYPES.has(o.type)) continue;
    parts.push(o.type + ',' + o.room + ',' + o.x + ',' + o.y + ',' + (o.level ?? '') + ',' + (o.user ?? ''));
  }
  parts.sort();
  return parts.join('|');
}

export class BackgroundCache {
  private byKey = new Map<string, HTMLImageElement>();
  private pending = new Map<string, Promise<HTMLImageElement | null>>();

  constructor(private fetchScene: (frameIndex: number) => Promise<{ svg: string }>, private layout: StageLayout) {}

  // returns the background image for a frame's epoch, or null if not ready yet
  get(frameIndex: number, key: string): HTMLImageElement | null {
    const img = this.byKey.get(key);
    if (img) return img;
    if (!this.pending.has(key)) {
      const p = this.fetchScene(frameIndex)
        .then((r) => svgToImage(r.svg))
        .then((im) => { this.byKey.set(key, im); return im; })
        .catch(() => null);
      this.pending.set(key, p);
    }
    return null;
  }

  // ensure a frame's epoch background is loaded (awaitable, for first paint)
  async ensure(frameIndex: number, key: string): Promise<HTMLImageElement | null> {
    if (this.byKey.has(key)) return this.byKey.get(key)!;
    this.get(frameIndex, key);
    return (await this.pending.get(key)) || null;
  }
}
