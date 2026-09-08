import styles from './WorkingDots.module.css';

// The "something is still happening" indicator, shared by every screen that
// waits on a long job.
//
// It was written for the host-action overlay and the setup screen had its own,
// weaker version — three static bullets fading as one block, below a 280px log,
// so on a short viewport it was off the bottom of the screen entirely. During a
// repair install, which is minutes of near-silent output, that left no sign the
// thing was alive. One implementation now, so they cannot drift again.
export function WorkingDots() {
  return (
    <div className={styles.dots} aria-label="working">
      <span /><span /><span /><span />
    </div>
  );
}
