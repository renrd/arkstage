const FIRST_RUN_KEY = "arkstage-first-run-v1";

export type FirstRunChoice = "main" | "all" | "none";

export function hasCompletedFirstRun(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) !== null;
  } catch {
    return true;
  }
}

export function completeFirstRun(choice: FirstRunChoice): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, JSON.stringify({ choice, at: Date.now() }));
  } catch {
    /* best effort */
  }
}

export function resetFirstRun(): void {
  try {
    localStorage.removeItem(FIRST_RUN_KEY);
  } catch {
    /* best effort */
  }
}
