export interface Scenario {
  name: string;
  hasMap: boolean;
  files: string[];
}

// A registered bot codebase, mounted read-only at /bots/<name>. `mounted` is
// probed on the server: a profile can be declared in .env but not yet mounted,
// because a bind mount is only established when the container is created.
export interface BotProfile {
  name: string;
  hostPath: string;
  legacy: boolean;
  dir: string;
  mounted: boolean;
  jsModuleCount: number;
  error: string | null;
}

export interface BotProfilesResponse {
  profiles: BotProfile[];
  default: string;
  usesLegacyKeys: boolean;
}

// Never carries a token or password — only whether one is set.
export interface ScreepsProfile {
  name: string;
  hostname: string;
  shard: string;
  port: string;
  protocol: string;
  path: string;
  hasToken: boolean;
  hasPassword: boolean;
  ownKeys: string[];
}

export interface ScreepsProfilesResponse {
  profiles: ScreepsProfile[];
  default: string;
  usesLegacyKeys: boolean;
}

// The host agent performs what the container cannot do for itself (recreate
// itself, rebuild the image). `running` is false unless a heartbeat is fresh,
// and `actions` is then empty — the UI must show the command to type rather
// than a button nothing will answer.
export interface HostAgentStatus {
  running: boolean;
  actions: string[];
  summaries: Record<string, string>;
  busy: boolean;
  lastResult: { id: string; action: string; ok: boolean; message: string | null; finishedAt: string } | null;
  pending: { id: string; action: string; requestedAt: string } | null;
}

// The parsed contents of a scenario's settings.json. `bots` maps a side
// ('main' is the scenario's own bot) to a bot profile name; `mods` lists the
// curated game mods the run loads (empty means vanilla Screeps).
export interface ScenarioSettings {
  bots: Record<string, string>;
  server?: string;
  mods?: string[];
}

// One entry of the curated catalog (GET /api/mods). The server owns this list;
// the UI never hardcodes one.
export interface ModProfile {
  id: string;
  name: string;
  description: string;
  version: string;
  supported: string[];
  unavailable: string[];
  requires: string[];
  conflicts: string[];
}

export interface ModsResponse {
  mods: ModProfile[];
}

export interface ScenarioSettingsResponse {
  present: boolean;
  settings: ScenarioSettings;
  warnings: string[];
  effectiveBot?: string;
  effectiveServer?: string;
  error?: string;
}

export interface ScenarioMapFile {
  path: string;
  map: unknown;
}

export interface ScenarioMapsResponse {
  maps: ScenarioMapFile[];
  errors: Array<{ path: string; error: string }>;
  revision: string;
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
  // side -> container dir of the codebase that produced this recording.
  // Absent on recordings made before bot profiles existed.
  bots?: Record<string, string>;
  // Curated game mods this run loaded. Absent on recordings made before mods
  // existed, which is the same thing as vanilla.
  mods?: string[];
  test?: TestResult | null;
}

export interface RecordingEntry {
  scenario: string;
  timestamp: string;
  relPath: string;
  // Derived server-side: the runner's endReason once finalised, or 'running' /
  // 'interrupted' for a run that never wrote one. 'unknown' when meta is absent.
  status: string;
  // null while the count on disk is untrustworthy (meta.ticks is written as 0
  // before the first tick and only corrected by finalize()).
  ticks: number | null;
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
  // Render-only ownership derived in memory from `user` + meta.botUserId.
  my?: boolean;
  hits?: number;
  hitsMax?: number;
  store?: Record<string, number>;
  body?: Array<{ type: string; hits: number }>;
  name?: string;
  level?: number;
  progress?: number;
  isPublic?: boolean;
  depositType?: string;
  [k: string]: unknown;
}

export interface Frame {
  gameTime: number;
  cpu?: number | null;   // ms of CPU the bot used this tick (null if unavailable / skipped)
  objects: FrameObject[];
  flags: unknown[];
  eventLog?: Record<string, unknown[]>;
  console?: string[];
  // The bot's own RoomVisual draws, captured per room as the engine's raw
  // newline-separated command strings (src/dojoWorld.js captureState). Optional:
  // recordings made before this was captured simply do not carry it.
  visuals?: Record<string, string>;
  // userId -> { username, score }. Season 5 pays score to a reactor's OWNER, so
  // it is a user field, not an object field. Absent on older recordings.
  users?: Record<string, { username?: string; score?: number }>;
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

export type JobEvent =
  | { type: 'start'; scenario: string; maxTicks: number; botUserId: string; bots?: Record<string, string>; mockEngineFeatures?: Record<string, boolean> }
  | { type: 'terrain'; terrain: Record<string, string[]>; botUserId: string }
  | { type: 'console'; lines: string[] }
  | { type: 'tick'; tick: number; maxTicks: number }
  | { type: 'frame'; frame: Frame }
  | { type: 'end'; endReason: string; ticks: number; recordingPath: string | null; test: TestResult | null; error?: string }
  | { type: 'fatal'; error: string }
  | { type: 'gone' };

export interface ActiveJob {
  jobId: string;
  kind: 'run' | 'test';
  scenario: string;
}
