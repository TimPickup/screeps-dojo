import type {
  Scenario, ScenarioMapsResponse, RecordingEntry, Recording, ActiveJob,
  BotProfilesResponse, ScreepsProfilesResponse, ScenarioSettingsResponse, HostAgentStatus
} from './types';
import { JSONParser } from '@streamparser/json';

async function jget<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  
  const parser = new JSONParser();
  let result;
  parser.onValue = ({ value, key, parent, stack }) => {
    if (stack.length === 0)
      result = value;
  };

  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.write(value);
  }

  return result;
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
  // Always pass a scenario when you have one: the server then walks a single
  // directory instead of every recording on disk.
  recordings: (scenario?: string) =>
    jget<RecordingEntry[]>('/api/recordings'
      + (scenario ? '?scenario=' + encodeURIComponent(scenario) : '')),
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

  createScenario: (name: string, room?: string) => jpost<{ name: string }>('/api/scenarios', { name, room }),
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
  scenarioSettings: (scenario: string) =>
    jget<ScenarioSettingsResponse>('/api/scenarios/' + encodeURIComponent(scenario) + '/settings'),
  verifyBot: (profile?: string) =>
    jget<{ ok: boolean; jsModuleCount?: number; mount?: string; error?: string }>(
      '/api/verify/bot' + (profile ? '?profile=' + encodeURIComponent(profile) : '')),
  verifyServer: (profile?: string) =>
    jget<{ ok: boolean; authMode?: 'token' | 'password'; active?: boolean; error?: string }>(
      '/api/verify/server' + (profile ? '?profile=' + encodeURIComponent(profile) : '')),
  bootstrapStatus: () => jget<{ phase: string }>('/api/bootstrap/status'),
  bootstrapStreamUrl: () => '/api/bootstrap/stream'
};
