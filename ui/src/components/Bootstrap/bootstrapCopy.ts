// What the setup screen says, kept out of the component so it can be tested —
// there is no jsdom here, so anything inside a component is unreachable.
//
// Two cases reach this screen. A first run, where nothing is installed yet; and
// a repair, where the container is holding an older node_modules than the code
// it is running. The second happens once to anyone updating from a release
// before the launchers renewed the anonymous volume, and it must not be
// described as a first run: someone with a project already on disk reads that
// as having lost it.
export function bootstrapCopy(reason: 'install' | 'repair' | null, failed: boolean) {
  if (failed) {
    return {
      title: '⛬ Setting up Screeps Dojo',
      sub: 'Install failed — check the log below and your Docker setup.'
    };
  }
  if (reason === 'repair') {
    return {
      title: '⛬ Finishing an update',
      // Deliberately not "installing what the update added": the repair is
      // sometimes a full reinstall, because packages carrying another version's
      // engine patches have to be replaced rather than topped up.
      sub: 'This container was still running the packages from a previous version. '
        + 'Reinstalling what this one needs — a few minutes, once. Your scenarios and '
        + 'recordings are untouched, and the GUI carries on by itself when it finishes.'
    };
  }
  return {
    title: '⛬ Setting up Screeps Dojo',
    sub: 'Installing the server toolchain (first run, a few minutes). '
      + 'You can leave this tab; the install keeps running.'
  };
}
