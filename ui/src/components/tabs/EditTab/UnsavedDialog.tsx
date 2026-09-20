// The three-answer prompt you get when you try to leave unsaved work.
//
// window.confirm only offers two, and "discard or stay" is the wrong pair —
// the answer people almost always want is "save it and carry on".

import styles from './EditTab.module.css';

export function UnsavedDialog({ file, onSave, onDiscard, onCancel }: {
	file: string;
	onSave: () => void;
	onDiscard: () => void;
	onCancel: () => void;
}) {
	return (
		<div className={styles.modalScrim} onClick={onCancel}>
			<div className={styles.modal} onClick={(event) => event.stopPropagation()}>
				<div className={styles.modalTitle}>Unsaved changes</div>
				<div className={styles.modalBody}>
					<code>{file}</code> has changes you have not saved.
				</div>
				<div className={styles.modalButtons}>
					<button type="button" className={styles.modalCancel} onClick={onCancel}>Cancel</button>
					<button type="button" className={styles.modalDiscard} onClick={onDiscard}>Discard</button>
					<button type="button" className={styles.modalSave} autoFocus onClick={onSave}>Save and continue</button>
				</div>
			</div>
		</div>
	);
}
