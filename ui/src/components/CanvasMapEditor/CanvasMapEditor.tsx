import { useEffect, useRef, useState } from 'react';
import type { Frame, FrameObject } from '../../api/types';
import { drawStaticScene } from '../../canvas/staticLayers';
import { populateFrameMy } from '../../canvas/ownership';
import { computeStageLayout } from '../../render/geometry';
import {
  makeEditableObject, parseEditableMap, serializeEditableMap, structureLayer,
  type EditableMap, type EditableObject,
} from './mapModel';
import styles from './CanvasMapEditor.module.css';
import { useRenderFonts } from '../../hooks/useRenderFonts';
import { useTerrainTextures } from '../../hooks/useTerrainTextures';

type Tool = { kind: 'select' } | { kind: 'terrain'; value: string } | { kind: 'object'; value: string };
type Selection = { kind: 'structure' | 'flag'; index: number } | null;
export type CanvasMapEditorChangeKind = 'load' | 'edit';

interface Props {
  value: string;
  onChange: (value: string, kind: CanvasMapEditorChangeKind) => void;
}

const OBJECTS = [
  'spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab', 'factory',
  'container', 'road', 'rampart', 'constructedWall', 'source', 'controller', 'mineral', 'flag',
];
const OWNED = new Set(['spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab', 'factory', 'rampart', 'controller']);
const STORE_CAPACITY: Record<string, number> = { storage: 1000000, terminal: 300000, container: 2000 };
const MINERALS = ['H', 'O', 'U', 'L', 'K', 'Z', 'X'];
const ROOM_RE = /^[WE]\d+[NS]\d+$/;

function frameFor(map: EditableMap): Frame {
  const objects: FrameObject[] = map.structures.map((object, index) => {
    const { owner, ...renderFields } = object;
    const output = {
      ...renderFields,
      _id: String(object._id || object.id || `editor-${index}`),
      type: object.type,
      room: map.room,
      x: object.x,
      y: object.y,
    } as FrameObject;
    if (output.user === undefined && owner !== undefined) output.user = owner;
    if (object.type === 'source') {
      const capacity = typeof object.energyCapacity === 'number' ? object.energyCapacity : 3000;
      output.energyCapacity = capacity;
      if (typeof object.energy !== 'number') output.energy = capacity;
    }
    return output;
  });
  const flags = map.flags.map((flag) => ({ room: map.room, ...flag }));
  return populateFrameMy({ gameTime: 0, objects, flags });
}

function findAt(map: EditableMap, x: number, y: number): Selection {
  const rank = { floor: 0, overlay: 1, main: 2 };
  let best = -1, bestRank = -1;
  map.structures.forEach((object, index) => {
    if (object.x !== x || object.y !== y) return;
    const value = rank[structureLayer(object.type)];
    if (value > bestRank) { best = index; bestRank = value; }
  });
  if (best !== -1) return { kind: 'structure', index: best };
  const flag = map.flags.findIndex((value) => value.x === x && value.y === y);
  return flag === -1 ? null : { kind: 'flag', index: flag };
}

function isClaimed(owner: unknown): boolean {
  return owner != null && owner !== 'neutral' && owner !== 'unclaimed';
}

export function CanvasMapEditor({ value, onChange }: Props) {
  const fontsReady = useRenderFonts();
  const terrainTextures = useTerrainTextures();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<EditableMap | null>(null);
  const onChangeRef = useRef(onChange);
  const lastEmittedRef = useRef<string | null>(null);
  const processedValueRef = useRef<string | null>(null);
  const paintingRef = useRef(false);
  const lastTileRef = useRef('');
  const [model, setModel] = useState<EditableMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [selection, setSelection] = useState<Selection>(null);
  const [borderWall, setBorderWall] = useState(true);
  const [roomText, setRoomText] = useState('');
  const [storeText, setStoreText] = useState('{}');
  const [storeError, setStoreError] = useState(false);
  const [hovered, setHovered] = useState<{ x: number; y: number } | null>(null);
  const [canvasSize, setCanvasSize] = useState(1);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (processedValueRef.current === value) return;
    processedValueRef.current = value;
    if (lastEmittedRef.current === value) return;
    const parsed = parseEditableMap(value);
    setError(parsed.error);
    if (!parsed.map) return;
    modelRef.current = parsed.map;
    setModel(parsed.map);
    setRoomText(parsed.map.room);
    setSelection(null);
    const normalized = serializeEditableMap(parsed.map);
    if (normalized !== value) {
      lastEmittedRef.current = normalized;
      onChangeRef.current(normalized, 'load');
    }
  }, [value]);

  const commit = (next: EditableMap) => {
    modelRef.current = next;
    setModel(next);
    const serialized = serializeEditableMap(next);
    lastEmittedRef.current = serialized;
    onChangeRef.current(serialized, 'edit');
  };

  useEffect(() => {
    const object = selection?.kind === 'structure' ? model?.structures[selection.index] : null;
    setStoreText(JSON.stringify(object?.store || {}));
    setStoreError(false);
  }, [selection, model]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const resize = () => setCanvasSize(Math.max(1, Math.min(host.clientWidth - 20, host.clientHeight - 20, 900)));
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model || !fontsReady || !terrainTextures) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(canvasSize * dpr));
    canvas.height = Math.max(1, Math.floor(canvasSize * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = canvasSize * dpr / 50;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const layout = computeStageLayout([model.room]);
    drawStaticScene(ctx, { terrain: { [model.room]: model.terrain }, frame: frameFor(model), layout }, { initialSourceEnergy: true, terrainTextures });
    if (hovered) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(hovered.x, hovered.y, 1, 1);
    }
    if (selection) {
      const selected = selection.kind === 'structure' ? model.structures[selection.index] : model.flags[selection.index];
      if (selected) {
        ctx.strokeStyle = '#65fd62';
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.arc(selected.x + 0.5, selected.y + 0.5, 0.62, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [model, selection, hovered, canvasSize, fontsReady, terrainTextures]);

  const tileFromPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(49, Math.floor((event.clientX - rect.left) * 50 / rect.width))),
      y: Math.max(0, Math.min(49, Math.floor((event.clientY - rect.top) * 50 / rect.height))),
    };
  };

  const applyAt = (x: number, y: number) => {
    const current = modelRef.current;
    if (!current) return;
    if (tool.kind === 'select') {
      setSelection(findAt(current, x, y));
      return;
    }
    if (tool.kind === 'terrain') {
      const actual = borderWall && (x === 0 || x === 49 || y === 0 || y === 49) ? '#' : tool.value;
      if (current.terrain[y][x] === actual) return;
      const terrain = current.terrain.slice();
      terrain[y] = terrain[y].slice(0, x) + actual + terrain[y].slice(x + 1);
      commit({ ...current, terrain });
      return;
    }
    if (tool.value === 'eraser') {
      const structures = current.structures.slice();
      const flags = current.flags.slice();
      const structureIndex = structures.findIndex((object) => object.x === x && object.y === y);
      const flagIndex = flags.findIndex((flag) => flag.x === x && flag.y === y);
      if (structureIndex === -1 && flagIndex === -1) return;
      if (structureIndex !== -1) structures.splice(structureIndex, 1);
      if (flagIndex !== -1) flags.splice(flagIndex, 1);
      setSelection(null);
      commit({ ...current, structures, flags });
      return;
    }
    if (tool.value === 'flag') {
      if (current.flags.some((flag) => flag.x === x && flag.y === y)) return;
      setSelection(null);
      commit({ ...current, flags: current.flags.concat({ name: `flag${current.flags.length}`, x, y }) });
      return;
    }
    let structures = current.structures;
    if (tool.value === 'controller') structures = structures.filter((object) => object.type !== 'controller');
    const layer = structureLayer(tool.value);
    structures = structures.filter((object) => !(object.x === x && object.y === y && structureLayer(object.type) === layer));
    setSelection(null);
    commit({ ...current, structures: structures.concat(makeEditableObject(tool.value, x, y)) });
  };

  const updateStructure = (index: number, change: (object: EditableObject) => EditableObject) => {
    const current = modelRef.current;
    if (!current || !current.structures[index]) return;
    const structures = current.structures.slice();
    structures[index] = change({ ...structures[index] });
    commit({ ...current, structures });
  };

  const selectedObject = selection?.kind === 'structure' && model ? model.structures[selection.index] : null;
  const selectedFlag = selection?.kind === 'flag' && model ? model.flags[selection.index] : null;
  const usedStore = selectedObject?.store ? Object.values(selectedObject.store).reduce((sum, amount) => sum + Number(amount || 0), 0) : 0;
  const capacity = selectedObject ? (STORE_CAPACITY[selectedObject.type] || 0) : 0;

  const deleteSelection = () => {
    const current = modelRef.current;
    if (!current || !selection) return;
    if (selection.kind === 'structure') commit({ ...current, structures: current.structures.filter((_, index) => index !== selection.index) });
    else commit({ ...current, flags: current.flags.filter((_, index) => index !== selection.index) });
    setSelection(null);
  };

  return (
    <div className={styles.root}>
      <aside className={styles.palette}>
        <section className={styles.section}>
          <div className={styles.label}>Room</div>
          <input className={ROOM_RE.test(roomText) ? styles.input : `${styles.input} ${styles.invalid}`}
            value={roomText} onChange={(event) => {
              const room = event.target.value.trim();
              setRoomText(event.target.value);
              const current = modelRef.current;
              if (current && ROOM_RE.test(room)) commit({ ...current, room });
            }} />
        </section>
        <section className={styles.section}>
          <div className={styles.label}>Tool</div>
          <button className={tool.kind === 'select' ? styles.activeWide : styles.wide} onClick={() => setTool({ kind: 'select' })}>▣ select / edit</button>
        </section>
        <section className={styles.section}>
          <div className={styles.label}>Terrain</div>
          {[['.', 'plain .'], ['~', 'swamp ~'], ['#', 'wall #']].map(([value, label]) => (
            <button key={value} className={tool.kind === 'terrain' && tool.value === value ? styles.active : styles.button}
              onClick={() => setTool({ kind: 'terrain', value })}>{label}</button>
          ))}
          <label className={styles.check}><input type="checkbox" checked={borderWall} onChange={(event) => setBorderWall(event.target.checked)} /> auto-wall border</label>
        </section>
        <section className={styles.section}>
          <div className={styles.label}>Objects</div>
          <div className={styles.grid}>
            {OBJECTS.map((value) => (
              <button key={value} className={tool.kind === 'object' && tool.value === value ? styles.active : styles.button}
                onClick={() => setTool({ kind: 'object', value })}>{value === 'constructedWall' ? 'constructed wall' : value}</button>
            ))}
            <button className={tool.kind === 'object' && tool.value === 'eraser' ? styles.active : styles.button}
              onClick={() => setTool({ kind: 'object', value: 'eraser' })}>eraser</button>
          </div>
        </section>
        <section className={styles.section}>
          <div className={styles.label}>Properties</div>
          {!selection && <div className={styles.muted}>Click a placed object to edit</div>}
          {selectedFlag && <label className={styles.property}>flag name<input className={styles.input} value={selectedFlag.name} onChange={(event) => {
            const current = modelRef.current; if (!current || selection?.kind !== 'flag') return;
            const flags = current.flags.slice(); flags[selection.index] = { ...flags[selection.index], name: event.target.value }; commit({ ...current, flags });
          }} /></label>}
          {selectedObject && OWNED.has(selectedObject.type) && <label className={styles.property}>owner<select className={styles.input}
            value={selectedObject.owner == null ? (selectedObject.type === 'controller' ? 'unclaimed' : 'me') : (selectedObject.owner === 'neutral' ? 'unclaimed' : selectedObject.owner)}
            onChange={(event) => updateStructure(selection!.index, (object) => {
              object.owner = event.target.value;
              if (object.type === 'controller') object.level = isClaimed(object.owner) ? (object.level || 1) : 0;
              return object;
            })}>
            <option value="me">me</option><option value="invader">invader</option><option value="unclaimed">unclaimed / neutral</option>
          </select></label>}
          {selectedObject && capacity > 0 && <>
            <label className={styles.property}>store<input className={storeError ? `${styles.input} ${styles.invalid}` : styles.input} value={storeText}
              onChange={(event) => {
                const text = event.target.value; setStoreText(text);
                try {
                  const store = JSON.parse(text);
                  if (!store || typeof store !== 'object' || Array.isArray(store)) throw new Error('store must be an object');
                  setStoreError(false); updateStructure(selection!.index, (object) => ({ ...object, store }));
                } catch { setStoreError(true); }
              }} /></label>
            <div className={usedStore > capacity ? styles.over : styles.muted}>{usedStore.toLocaleString()} / {capacity.toLocaleString()}{usedStore > capacity ? ' ⚠ over capacity' : ''}</div>
          </>}
          {selectedObject?.type === 'controller' && isClaimed(selectedObject.owner) && <label className={styles.property}>level<input className={styles.input} type="number" min={0} max={8} value={selectedObject.level || 1}
            onChange={(event) => updateStructure(selection!.index, (object) => ({ ...object, level: Number(event.target.value) }))} /></label>}
          {selectedObject?.type === 'mineral' && <>
            <label className={styles.property}>mineral<select className={styles.input} value={selectedObject.mineralType || 'H'}
              onChange={(event) => updateStructure(selection!.index, (object) => ({ ...object, mineralType: event.target.value }))}>
              {MINERALS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label className={styles.property}>density<select className={styles.input} value={selectedObject.density || 3}
              onChange={(event) => updateStructure(selection!.index, (object) => ({ ...object, density: Number(event.target.value) }))}>
              {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
            </select></label>
          </>}
          {selection && <button className={styles.delete} onClick={deleteSelection}>Delete</button>}
        </section>
      </aside>
      <div ref={hostRef} className={styles.canvasHost}>
        {error && <div className={styles.error}>Cannot render map: {error}</div>}
        {model && <canvas ref={canvasRef} className={styles.canvas} style={{ width: canvasSize, height: canvasSize }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const tile = tileFromPointer(event); lastTileRef.current = `${tile.x},${tile.y}`;
            paintingRef.current = tool.kind !== 'select'; applyAt(tile.x, tile.y);
          }}
          onPointerMove={(event) => {
            const tile = tileFromPointer(event); setHovered(tile);
            if (!paintingRef.current || !(event.buttons & 1)) return;
            const key = `${tile.x},${tile.y}`; if (key === lastTileRef.current) return; lastTileRef.current = key;
            applyAt(tile.x, tile.y);
          }}
          onPointerUp={() => { paintingRef.current = false; lastTileRef.current = ''; }}
          onPointerLeave={() => { paintingRef.current = false; lastTileRef.current = ''; setHovered(null); }} />}
      </div>
    </div>
  );
}
