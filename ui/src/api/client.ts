import type {
  Scenario, ScenarioTree, ScenarioEntryInfo, ScenarioTemplate, CopyableScenario, ScenarioMapsResponse, RecordingEntry, Recording, ActiveJob,
  BotProfilesResponse, ScreepsProfilesResponse, ScenarioSettingsResponse, HostAgentStatus,
  ModsResponse
} from './types';
import { JSONParser } from '@streamparser/json';

// Above this, parse the response as it streams; below it, hand the whole body
// to the engine's own parser.
//
// `res.json()` decodes the body to one JavaScript string before parsing it, and
// V8 caps a single string at roughly 512 MB — a recording past that threw before
// it could be parsed at all, which is what the streaming path is here for. But
// the streaming parser is JavaScript walking the document character by character,
// where `res.json()` is the engine's C++ parser: measured on a 169 MB recording,
// 8.2s against 1.9s, all of it on the main thread. Paying that on every response,
// including the handful of bytes `/api/health` returns, is the wrong default.
//
// 256 MB rather than the full 512: Content-Length counts BYTES and the cap is on
// CHARACTERS, so a document with any multi-byte text needs headroom, and the
// parse holds the string and the object graph at once.
export const NATIVE_PARSE_LIMIT = 256 * 1024 * 1024;

// Exported for its unit tests: there is no jsdom here, so the only way to cover
// the parser choice is to call it against a stubbed fetch.
export async function jget<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error((await res.text()) || res.statusText);

  // No Content-Length means no way to know, so take the path that cannot fail.
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 0 && declared <= NATIVE_PARSE_LIMIT) {
    return res.json() as Promise<T>;
  }
  if (!res.body) return res.json() as Promise<T>;

  const parser = new JSONParser();
  let result: unknown;
  parser.onValue = ({ value, stack }) => {
    if (stack.length === 0) result = value;
  };

  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.write(value);
  }

  return result as T;
}

async function jpost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  health: () => jget<{ ok: boolean; ready: boolean }>('/api/health'),
  version: () => jget<{ current: string; latest: string | null; updateAvailable: boolean; repoUrl: string }>('/api/version'),
  scenarios: () => jget<Scenario[]>('/api/scenarios'),
  scenarioTree: () => jget<ScenarioTree>('/api/scenario-tree'),
  // SSE: pushes the whole tree whenever it changes on disk. Replaces the old
  // manual refresh button; the server only polls while someone is listening.
  scenarioTreeStreamUrl: () => '/api/scenario-tree/stream',
  scenarioEntry: (p: string) => jget<ScenarioEntryInfo>('/api/scenario-entry?path=' + encodeURIComponent(p)),
  createFolder: (name: string, parent?: string) =>
    jpost<{ name: string; path: string }>('/api/scenario-folders', { name, parent: parent || '' }),
  renameEntry: (p: string, name: string) =>
    jpost<{ ok: boolean; path: string }>('/api/scenario-entry/rename', { path: p, name }),
  moveEntry: (p: string, parent: string) =>
    jpost<{ ok: boolean; path: string }>('/api/scenario-entry/move', { path: p, parent }),
  // `force` is how the GUI says the user saw the "folder is not empty" warning;
  // without it the server refuses to delete a non-empty folder.
  deleteEntry: async (p: string, force = false) => {
    const res = await fetch('/api/scenario-entry?path=' + encodeURIComponent(p) + (force ? '&force=1' : ''), { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText) as Error & { status?: number; folders?: number; scenarios?: number };
      err.status = res.status; err.folders = data.folders; err.scenarios = data.scenarios;
      throw err;
    }
    return data as { ok: boolean };
  },
  // Always pass a scenario when you have one: the server then walks a single
  // directory instead of every recording on disk.
  recordings: (scenario?: string) =>
    jget<RecordingEntry[]>('/api/recordings'
      + (scenario ? '?scenario=' + encodeURIComponent(scenario) : '')),
  // Runs left in the old top-level recordings/ that no scenario owns any more.
  orphanedRecordings: () =>
    jget<{ root: string; entries: { name: string; runs: number; bytes: number }[]; runs: number; bytes: number }>(
      '/api/recordings/orphans'),
  clearOrphanedRecordings: async () => {
    const res = await fetch('/api/recordings/orphans', { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json() as Promise<{ removed: number; bytes: number }>;
  },
  recording: (relPath: string) =>
    jget<Recording>('/api/recordings/file?path=' + encodeURIComponent(relPath)),
  run: (scenario: string, record = false) =>
    jpost<{ jobId: string }>('/api/run', { scenario, record }),
  test: (scenario: string, record = false) =>
    jpost<{ jobId: string }>('/api/test', { scenario, record }),
  abort: (jobId: string) => jpost<{ ok: boolean }>('/api/jobs/' + jobId + '/abort', {}),
  activeJob: () => jget<ActiveJob | null>('/api/jobs/active'),
  streamUrl: (jobId: string) => '/api/jobs/' + jobId + '/stream',
  render: (path: string, format: 'gif' | 'mp4', speed?: number) =>
    jpost<{ id: string }>('/api/render', { path, format, speed }),
  cancelRender: (id: string) => jpost<{ ok: boolean }>('/api/render/' + encodeURIComponent(id) + '/cancel', {}),
  renderStreamUrl: (id: string) => '/api/render/' + id + '/stream',
  renderFileUrl: (relPath: string) => '/api/render/file?path=' + encodeURIComponent(relPath),

  scenarioTemplates: () =>
    jget<{ templates: ScenarioTemplate[]; scenarios: CopyableScenario[] }>('/api/scenario-templates'),
  createScenario: (name: string, parent?: string, template?: string) =>
    jpost<{ name: string; path: string }>('/api/scenarios', {
      name, parent: parent || '', template: template || 'basic'
    }),
  deleteFile: async (scenario: string, path: string) => {
    const res = await fetch('/api/scenarios/' + encodeURIComponent(scenario) + '/file?path=' + encodeURIComponent(path), { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  },
  renameFile: (scenario: string, from: string, to: string) =>
    jpost<{ ok: boolean }>('/api/scenarios/' + encodeURIComponent(scenario) + '/rename', { from, to }),
  files: (scenario: string) => jget<{ path: string; kind: string }[]>('/api/scenarios/' + encodeURIComponent(scenario) + '/files'),
  maps: (scenario: string) => jget<ScenarioMapsResponse>('/api/scenarios/' + encodeURIComponent(scenario) + '/maps'),
  file: (scenario: string, path: string) =>
    jget<{ content: string }>('/api/scenarios/' + encodeURIComponent(scenario) + '/file?path=' + encodeURIComponent(path)),
  saveFile: async (scenario: string, path: string, content: string) => {
    const res = await fetch('/api/scenarios/' + encodeURIComponent(scenario) + '/file?path=' + encodeURIComponent(path), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  },
  importRooms: (scenario: string, rooms: string[], options?: {
    memory?: boolean; segments?: boolean; creeps?: boolean; structures?: boolean; overwrite?: boolean;
  }) =>
    jpost<{ importId: string }>('/api/scenarios/' + encodeURIComponent(scenario) + '/import', {
      rooms,
      memory: options?.memory === true,
      segments: options?.segments === true,
      creeps: options?.creeps !== false,
      structures: options?.structures !== false,
      overwrite: options?.overwrite === true
    }),
  importStreamUrl: (id: string) => '/api/import/' + id + '/stream',
  // Pass the scenario so the token check targets the server profile that
  // scenario will actually import from.
  tokenStatus: (scenario?: string) =>
    jget<{ active: boolean; needsActivation: boolean; authMode?: 'token' | 'password'; maskedUrl?: string; error?: string }>(
      '/api/import/token-status' + (scenario ? '?scenario=' + encodeURIComponent(scenario) : '')),
  activateUrl: '/api/import/activate',
  activateUrlFor: (scenario?: string) =>
    '/api/import/activate' + (scenario ? '?scenario=' + encodeURIComponent(scenario) : ''),

  getEnv: () => jget<{ values: Record<string, string>; secrets: string[] }>('/api/env'),
  // `remove` deletes keys outright — blanking them would leave a nameless
  // profile in the Settings list, since a bare KEY= still declares one.
  putEnv: async (values: Record<string, string>, remove: string[] = []) => {
    const res = await fetch('/api/env', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values, remove }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json() as Promise<{ ok: boolean; restartRequired: boolean }>;
  },
  hostAgent: () => jget<HostAgentStatus>('/api/host-agent'),
  hostAgentLog: (lines = 40) => jget<{ lines: string[] }>('/api/host-agent/log?lines=' + lines),
  // The action is a name from a closed server-side list; nothing else is sent,
  // and nothing sent ever reaches a command line on the host.
  hostAgentRequest: (action: string) =>
    jpost<{ ok: boolean; id: string; action: string }>('/api/host-agent/request', { action }),
  // Renaming happens on the server: it is the only side that can see a token,
  // so a browser-side rename could not carry one across.
  renameProfile: (kind: 'bot' | 'screeps', from: string, to: string) =>
    jpost<{ ok: boolean; renamed: number }>('/api/env/rename-profile', { kind, from, to }),
  bots: () => jget<BotProfilesResponse>('/api/bots'),
  servers: () => jget<ScreepsProfilesResponse>('/api/servers'),
  mods: () => jget<ModsResponse>('/api/mods'),
  scenarioSettings: (scenario: string) =>
    jget<ScenarioSettingsResponse>('/api/scenarios/' + encodeURIComponent(scenario) + '/settings'),
  verifyBot: (profile?: string) =>
    jget<{ ok: boolean; jsModuleCount?: number; mount?: string; error?: string }>(
      '/api/verify/bot' + (profile ? '?profile=' + encodeURIComponent(profile) : '')),
  verifyServer: (profile?: string) =>
    jget<{ ok: boolean; authMode?: 'token' | 'password'; active?: boolean; error?: string }>(
      '/api/verify/server' + (profile ? '?profile=' + encodeURIComponent(profile) : '')),
  // reason: 'install' on a genuine first run, 'repair' when the container is
  // holding an older node_modules than the code it is running.
  bootstrapStatus: () => jget<{ phase: string; reason: 'install' | 'repair' | null }>('/api/bootstrap/status'),
  bootstrapStreamUrl: () => '/api/bootstrap/stream'
};
