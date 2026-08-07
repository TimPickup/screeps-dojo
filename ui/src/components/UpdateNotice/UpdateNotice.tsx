import { useState } from 'react';
import { HostAgentAction } from '../Settings/HostAgentAction';
import { ACTION_DURATION } from '../../state/hostAction';
import styles from './UpdateNotice.module.css';

interface Props {
  current: string;
  latest: string | null;
  repoUrl: string;
}

const MANUAL_COMMAND = 'npm run update';

// "A new version is available" is a warning; updating is an ordinary action.
// Painting them as one red block put a green button inside a red panel and made
// the safe, one-click path look alarming — so the alert is just the alert, and
// everything you might DO about it sits below it on the normal background.
//
// Order matters too: the button comes first and the terminal command is the
// alternative, which is the reverse of how this read before.
export function UpdateNotice({ current, latest, repoUrl }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(MANUAL_COMMAND).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); },
      () => {}
    );
  };

  return (
    <section className={styles.wrap}>
      <div className={styles.alert}>
        ⬆ A new version <b>v{latest}</b> is available — you have v{current}.
      </div>

      <h3 className={styles.heading}>Update</h3>
      <p className={styles.lead}>Take it now, without leaving the browser.</p>

      {/* No `fallback`: the manual command has its own place below, and saying
          it twice was part of what made this block feel like a wall of text. */}
      <div className={styles.action}>
        <HostAgentAction action="update" label={'Update to v' + latest} />
      </div>

      <p className={styles.note}>
        The service restarts as part of this, so leave the page alone while it runs.
        Expect it to take <b>{ACTION_DURATION.update}</b>.
      </p>

      <p className={styles.links}>
        <a href={repoUrl + '/releases'} target="_blank" rel="noreferrer">
          What changed <span className={styles.extIcon} aria-hidden="true">↗</span>
        </a>
      </p>

      <div className={styles.alt}>
        <span className={styles.altRule}>or update manually</span>
        <div className={styles.cmdRow}>
          <code className={styles.cmd}>{MANUAL_COMMAND}</code>
          <button type="button" className={styles.copy} onClick={copy}>{copied ? 'copied' : 'copy'}</button>
        </div>
        <span className={styles.altHint}>Run it on the host, in the dojo folder.</span>
      </div>
    </section>
  );
}
