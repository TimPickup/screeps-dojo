// Display helpers for the Replays list. A recording's directory name
// (YYYYMMDD-HHMMSS) is the one timestamp always present — meta.createdAt only
// exists for runs recorded by a runner new enough to write it — so the list
// labels are derived from the directory name and degrade to it verbatim.

const DIR_NAME_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

export function formatRecordingTimestamp(timestamp: string): string {
  const m = DIR_NAME_RE.exec(timestamp);
  if (!m) return timestamp;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

export function statusLabel(status: string | undefined): string {
  if (!status) return 'unknown';
  // 'running' and 'interrupted' are derived server-side from how recently the
  // run last wrote; everything else is the runner's own endReason.
  if (status === 'running') return 'running…';
  return status;
}

// The second line of a row: when the run happened, how far it got, and why it
// stopped. ticks is null whenever the count on disk is not trustworthy yet.
//
// includeStatus is false when the badge above the line is already the status —
// otherwise an unfinalised run reads 'interrupted' twice in two lines. Rows that
// badge PASS/FAIL still want it, since the badge says nothing about the ending.
export function recordingSubtitle(
  entry: { timestamp: string; status?: string; ticks: number | null },
  options: { includeStatus?: boolean } = {}
): string {
  const when = formatRecordingTimestamp(entry.timestamp);
  const ticks = entry.ticks === null || entry.ticks === undefined ? null : `${entry.ticks}t`;
  const status = options.includeStatus === false ? null : statusLabel(entry.status);
  return [when, ticks, status].filter(Boolean).join(' · ');
}
