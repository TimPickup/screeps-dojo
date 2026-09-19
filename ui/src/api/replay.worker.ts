import { readReplay } from './replayStream';

let acknowledge: (() => void) | undefined;
let streamId: string | null = null;
let urgent = false;
let applied = false;
let updating = false;

// Serialize changes: a quick seek forward and back must leave the server paced.
async function updatePriority() {
  if (!streamId || updating) return;
  updating = true;
  try {
    while (urgent !== applied) {
      const next = urgent;
      const response = await fetch('/api/recordings/streams/' + encodeURIComponent(streamId) + '/priority', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urgent: next }),
      });
      if (response.status === 404) return; // The download already finished.
      if (!response.ok) throw new Error('Unable to adjust replay loading speed.');
      applied = next;
    }
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  } finally { updating = false; }
}

self.onmessage = async ({ data }) => {
  if (data === 'ack') { acknowledge?.(); return; }
  if (data?.type === 'priority') { urgent = data.urgent; void updatePriority(); return; }
  try {
    const response = await fetch('/api/recordings/file?progressive=1&path=' + encodeURIComponent(data));
    streamId = response.headers.get('X-Replay-Stream');
    void updatePriority();
    await readReplay(response,
      (batch) => new Promise<void>((resolve) => {
        acknowledge = resolve;
        self.postMessage(batch);
      }));
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
