import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import styles from './Settings.module.css';

interface Orphans {
  root: string;
  entries: { name: string; runs: number; bytes: number }[];
  runs: number;
  bytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return (value < 10 ? value.toFixed(1) : Math.round(value)) + ' ' + units[unit];
}

/**
 * Replays now live inside their scenario, and the server moves the old
 * top-level recordings/ across on first start. What it cannot move is a run
 * whose scenario no longer exists — there is nowhere to put it, and guessing
 * would be worse than leaving it alone.
 *
 * So it sits there, invisible, taking disk. This says how much and offers to
 * clear it. The size is a directory walk, so it is only read when the panel is
 * open, and the delete confirms in place rather than through a browser dialog.
 */
export function OrphanedRecordings() {
  const [orphans, setOrphans] = useState<Orphans | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState<{ removed: number; bytes: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.orphanedRecordings()
      .then((r) => { if (!cancelled) setOrphans(r); })
      .catch((e: Error) => { if (!cancelled) setError(String(e.message || e)); });
    return () => { cancelled = true; };
  }, []);

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.clearOrphanedRecordings();
      setCleared(r);
      setOrphans({ root: orphans?.root || '', entries: [], runs: 0, bytes: 0 });
      setConfirming(false);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  // Nothing to clear and nothing went wrong: say nothing at all rather than
  // put a permanent empty box in Settings.
  if (!error && !cleared && (orphans === null || orphans.entries.length === 0)) return null;

  const biggest = orphans ? orphans.entries.slice(0, 5) : [];
  const rest = orphans ? orphans.entries.length - biggest.length : 0;

  return (
    <div className={styles.section}>
      <div className={styles.label}>Orphaned recordings</div>
      {error && <div className={styles.bad}>{error}</div>}
      {cleared && (
        <div className={styles.note}>
          Cleared {cleared.removed} folder{cleared.removed === 1 ? '' : 's'}, freeing {formatBytes(cleared.bytes)}.
        </div>
      )}

      {orphans && orphans.entries.length > 0 && (
        <>
          <p className={styles.help}>
            Replays live inside their scenario now. These {orphans.runs} run{orphans.runs === 1 ? '' : 's'} in{' '}
            {orphans.entries.length} folder{orphans.entries.length === 1 ? '' : 's'} are left in the old{' '}
            <code>recordings/</code> because the scenario that produced them no longer exists — nothing to move
            them into. They take <b>{formatBytes(orphans.bytes)}</b>.
          </p>
          <ul className={styles.orphanList}>
            {biggest.map((entry) => (
              <li key={entry.name}>
                <span className={styles.orphanName}>{entry.name}</span>
                <span className={styles.orphanSize}>{entry.runs} run{entry.runs === 1 ? '' : 's'} · {formatBytes(entry.bytes)}</span>
              </li>
            ))}
            {rest > 0 && <li className={styles.orphanMore}>…and {rest} more</li>}
          </ul>

          {confirming ? (
            <div className={styles.warnBox}>
              Permanently delete all {orphans.entries.length} folders and {formatBytes(orphans.bytes)} of replays?
              These are the only copy — this cannot be undone.
              <span className={styles.orphanActions}>
                <button className={styles.cancelBtn} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
                <button className={styles.dangerBtn} disabled={busy} onClick={clear}>
                  {busy ? 'Deleting…' : 'Delete them'}
                </button>
              </span>
            </div>
          ) : (
            <button className={styles.dangerBtn} onClick={() => setConfirming(true)}>
              Clear all ({formatBytes(orphans.bytes)})
            </button>
          )}
        </>
      )}
    </div>
  );
}
