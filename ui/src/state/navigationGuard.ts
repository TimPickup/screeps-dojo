// A single place for "are you sure you want to leave?".
//
// The Edit tab holds a draft that only lives in React state, and the tab strip,
// the breadcrumbs and the back button all unmount it without asking — so a map
// you just spent ten minutes on vanishes with no warning. Anything that
// navigates away from the current view goes through guardedNavigate, and
// whoever holds unsaved work registers a guard.
//
// The guard is asynchronous because a useful prompt has three answers (save,
// discard, cancel) and window.confirm only offers two: it either calls
// `proceed` immediately, or opens its own dialog and calls it on the answer.

export type NavigationGuard = (proceed: () => void) => void;

let guard: NavigationGuard | null = null;

// Registering replaces whatever was there: only one view holds unsaved work at
// a time, and a stale guard from an unmounted one would block navigation
// forever. Pass null to clear.
export function setNavigationGuard(next: NavigationGuard | null): void {
	guard = next;
}

// Clears the guard only if it is still the one you registered, so a component
// unmounting after a newer one has registered does not wipe the newer guard.
export function clearNavigationGuard(own: NavigationGuard): void {
	if (guard === own) guard = null;
}

export function guardedNavigate(proceed: () => void): void {
	if (guard) guard(proceed);
	else proceed();
}

export function hasNavigationGuard(): boolean {
	return guard !== null;
}
