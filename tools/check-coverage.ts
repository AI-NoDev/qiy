/**
 * Coverage gate for CI. Runs the suite with Bun's text coverage reporter and
 * fails when the aggregate function/line coverage drops below the thresholds.
 */
const MIN_FUNCS = Number(process.env.QIY_COVERAGE_MIN_FUNCS ?? 78);
const MIN_LINES = Number(process.env.QIY_COVERAGE_MIN_LINES ?? 85);

const child = Bun.spawnSync([process.execPath, "test", "--coverage"], {
  cwd: process.cwd(),
  stdout: "pipe",
  stderr: "pipe",
});
const output = child.stdout.toString() + child.stderr.toString();
const line = output.split(/\r?\n/).find((value) => /^All files\s+\|/.test(value));
if (!line) {
  console.error("Coverage summary not found. Last output:\n" + output.slice(-4000));
  process.exit(1);
}
const columns = line.split("|").map((value) => value.trim());
const funcs = Number(columns[1]);
const lines = Number(columns[2]);
console.log(`Coverage: ${funcs}% functions, ${lines}% lines (minimum ${MIN_FUNCS}/${MIN_LINES})`);
if (child.exitCode !== 0) {
  console.error("Tests failed while collecting coverage.");
  process.exit(child.exitCode ?? 1);
}
if (!Number.isFinite(funcs) || !Number.isFinite(lines) || funcs < MIN_FUNCS || lines < MIN_LINES) {
  console.error(`Coverage gate failed: need >= ${MIN_FUNCS}% functions and >= ${MIN_LINES}% lines.`);
  process.exit(1);
}
