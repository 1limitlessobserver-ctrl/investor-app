// What the app tells the developer console when something fails that the investor is not shown,
// or not in full: a storage that could not be read or written, a step of signing out that did not
// go through, a check that could not run. It says where, and passes on what was thrown, as it was:
// nothing about the investor is added, and nothing leaves the device (no third party is told).

/** Reports a failure the app carries on from: `where` names the step, `error` is what it threw. */
export function reportProblem(where: string, error: unknown): void {
  console.warn(`[investor-app] ${where}:`, error);
}
