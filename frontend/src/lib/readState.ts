// Tracks which stories the user has opened in the player ("read"), so the
// bookshelf can distinguish read vs unread chapters. Persisted in localStorage
// (independent of the download cache — a story can be read without being cached,
// or cached without being read).

const KEY = "arkstage-read-stories";

export function getReadStories(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Mark one story (by page_title) as read; persists immediately. */
export function markRead(pageTitle: string): void {
  try {
    const s = getReadStories();
    if (s.has(pageTitle)) return;
    s.add(pageTitle);
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable — read state is best-effort */
  }
}

// "Last watched" — the most recently opened story (by page_title), so the shelf
// and chapter list can point the user back to where they left off ("上次观看").
const LAST_KEY = "arkstage-last-watched";

export function getLastWatched(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function setLastWatched(pageTitle: string): void {
  try {
    localStorage.setItem(LAST_KEY, pageTitle);
  } catch {
    /* best-effort */
  }
}

// Per-story line checkpoint. The engine's displayed line is a source-line index,
// so it survives app restarts and can be fed to StoryPlayer.seekToLine together
// with the decision history needed to reach a branch.
const LINE_PREFIX = "arkstage-line:";

export interface StoryChoices {
  decisionId: number;
  optionIndex: number;
}

export interface SavedLine {
  lineIndex: number;
  selections: StoryChoices[];
  updatedAt: number;
}

export function getSavedLine(pageTitle: string): SavedLine | null {
  try {
    const raw = localStorage.getItem(LINE_PREFIX + pageTitle);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedLine>;
    if (!Number.isInteger(parsed.lineIndex) || (parsed.lineIndex as number) < 0) return null;
    const selections = Array.isArray(parsed.selections)
      ? parsed.selections.filter(
          (choice): choice is StoryChoices =>
            !!choice &&
            Number.isInteger(choice.decisionId) &&
            Number.isInteger(choice.optionIndex)
        )
      : [];
    return { lineIndex: parsed.lineIndex as number, selections, updatedAt: parsed.updatedAt ?? 0 };
  } catch {
    return null;
  }
}

export function saveLine(pageTitle: string, lineIndex: number, selections: StoryChoices[]): void {
  if (!pageTitle || !Number.isInteger(lineIndex) || lineIndex < 0) return;
  try {
    localStorage.setItem(
      LINE_PREFIX + pageTitle,
      JSON.stringify({ lineIndex, selections, updatedAt: Date.now() } satisfies SavedLine)
    );
  } catch {
    /* best-effort */
  }
}

export function clearSavedLine(pageTitle: string): void {
  try {
    localStorage.removeItem(LINE_PREFIX + pageTitle);
  } catch {
    /* best-effort */
  }
}
