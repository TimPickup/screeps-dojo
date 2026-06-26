export interface Scenario {
  name: string;
  hasMap: boolean;
  files: string[];
}

export interface TestResult {
  passed: boolean;
  message: string | null;
}

export interface RecordingMeta {
  scenario: string;
  endReason: string;
  ticks: number;
  createdAt?: string;
  botUserId?: string;
  test?: TestResult | null;
}

export interface RecordingEntry {
  scenario: string;
  timestamp: string;
  relPath: string;
  meta: RecordingMeta | null;
}

// A single recorded/streamed frame. objects are raw screeps docs.
export interface FrameObject {
  _id: string;
  type: string;
  x: number;
  y: number;
  room: string;
  user?: string;
  hits?: number;
  hitsMax?: number;
  store?: Record<string, number>;
  body?: Array<{ type: string; hits: number }>;
  name?: string;
  level?: number;
  progress?: number;
  [k: string]: unknown;
}

export interface Frame {
  gameTime: number;
  cpu?: number | null;   // ms of CPU the bot used this tick (null if unavailable / skipped)
  objects: FrameObject[];
  flags: unknown[];
  eventLog?: Record<string, unknown[]>;
  console?: string[];
}

export interface Recording {
  meta: RecordingMeta;
  terrain: Record<string, string[]>;
  frames: Frame[];
}

export interface StageLayout {
  rooms: string[];
  offsets: Record<string, { col: number; row: number }>;
  pixelsPerRoom: number;
  width: number;
  height: number;
}

// Live frame from the run child: a rendered SVG plus the raw objects (for the
// inspector) — NOT the heavy FrameView shape.
export interface LiveFrame {
  gameTime: number;
  objects: FrameObject[];
  console?: string[];
  svg: string | null;
}

export type JobEvent =
  | { type: 'start'; scenario: string; maxTicks: number; botUserId: string }
  | { type: 'terrain'; terrain: Record<string, string[]>; botUserId: string }
  | { type: 'layout'; layout: StageLayout }
  | { type: 'console'; lines: string[] }
  | { type: 'tick'; tick: number; maxTicks: number }
  | { type: 'frame'; gameTime: number; objects: FrameObject[]; console?: string[]; svg: string | null }
  | { type: 'end'; endReason: string; ticks: number; recordingPath: string | null; test: TestResult | null; error?: string }
  | { type: 'fatal'; error: string }
  | { type: 'gone' };

export interface ActiveJob {
  jobId: string;
  kind: 'run' | 'test';
  scenario: string;
}
