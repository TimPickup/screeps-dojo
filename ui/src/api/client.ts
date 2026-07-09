import type { Scenario, RecordingEntry, Recording, ActiveJob } from './types';

async function jget<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
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
  recordings: () => jget<RecordingEntry[]>('/api/recordings'),
  recording: (relPath: string) =>
    jget<Recording>('/api/recordings/file?path=' + encodeURIComponent(relPath)),
  renderedRecording: (relPath: string) =>
    jget<{ layout: import('./types').StageLayout; frames: string[]; visualLayers: string[] }>(
      '/api/recordings/rendered?path=' + encodeURIComponent(relPath)),
  run: (scenario: string, record = false) =>
    jpost<{ jobId: string }>('/api/run', { scenario, record }),
  test: (scenario: string, record = false) =>
    jpost<{ jobId: string }>('/api/test', { scenario, record }),
  abort: (jobId: string) => jpost<{ ok: boolean }>('/api/jobs/' + jobId + '/abort', {}),
  activeJob: () => jget<ActiveJob | null>('/api/jobs/active'),
  streamUrl: (jobId: string) => '/api/jobs/' + jobId + '/stream',
  render: (path: string, format: 'gif' | 'mp4') =>
    jpost<{ id: string }>('/api/render', { path, format }),
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
  file: (scenario: string, path: string) =>
    jget<{ content: string }>('/api/scenarios/' + encodeURIComponent(scenario) + '/file?path=' + encodeURIComponent(path)),
  saveFile: async (scenario: string, path: string, content: string) => {
    const res = await fetch('/api/scenarios/' + encodeURIComponent(scenario) + '/file?path=' + encodeURIComponent(path), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  },
  importRooms: (scenario: string, rooms: string[]) =>
    jpost<{ importId: string }>('/api/scenarios/' + encodeURIComponent(scenario) + '/import', { rooms }),
  importStreamUrl: (id: string) => '/api/import/' + id + '/stream',
  tokenStatus: () => jget<{ active: boolean; needsActivation: boolean; maskedUrl?: string; error?: string }>('/api/import/token-status'),
  activateUrl: '/api/import/activate',

  getEnv: () => jget<{ values: Record<string, string>; secrets: string[] }>('/api/env'),
  putEnv: async (values: Record<string, string>) => {
    const res = await fetch('/api/env', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json() as Promise<{ ok: boolean; restartRequired: boolean }>;
  },
  verifyBot: () => jget<{ ok: boolean; jsModuleCount?: number; error?: string }>('/api/verify/bot'),
  verifyServer: () => jget<{ ok: boolean; active?: boolean; error?: string }>('/api/verify/server'),
  bootstrapStatus: () => jget<{ phase: string }>('/api/bootstrap/status'),
  bootstrapStreamUrl: () => '/api/bootstrap/stream'
};
