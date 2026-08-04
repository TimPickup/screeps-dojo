// Harness warnings and bot errors are marked with '⚠' by the runner
// (src/harnessWarnings.js, src/scenarioRunner.js). Every console view highlights
// them the same way, so the check lives here rather than being re-guessed in
// each component — the replay viewer prefixes lines with their tick ("[42] …"),
// which is why this cannot be a plain startsWith.
const WARNING_LINE = /^(?:\[\d+\]\s*)?⚠/;

export function isWarningLine(line: string): boolean {
  return WARNING_LINE.test(line);
}
