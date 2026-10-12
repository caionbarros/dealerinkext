import type { LoadedPdf, TextEdit } from "./pdf";
import { pageText, type PageText } from "./textLayer";

/** A PDF the person opened. Its bytes are kept to build the result. */
export type Doc = { id: string; name: string; bytes: Uint8Array; pdf: LoadedPdf; color: number };

/**
 * One page in the result. `turn` is the rotation added here, on top of the
 * page's own; `edits` are the text changes written on it. Entries are never
 * changed in place, so the history can keep old lists as they were.
 */
export type Page = { key: string; docId: string; index: number; turn: number; edits: TextEdit[] };

export const docs = new Map<string, Doc>();

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notify(): void {
  for (const listener of listeners) listener();
}

const HISTORY_LIMIT = 100;

export const state = {
  pages: [] as Page[],
  selected: new Set<string>(),
  anchor: null as string | null,
  past: [] as Page[][],
  future: [] as Page[][],
  /** Changes since the last full download, so closing the tab can warn. */
  unsaved: false,
  busy: false,
};

let nextId = 1;
export const newId = (prefix: string) => `${prefix}${nextId++}`;

/** Every edit goes through here, so undo covers all of them. */
export function change(next: Page[]): void {
  state.past.push(state.pages);
  if (state.past.length > HISTORY_LIMIT) state.past.shift();
  state.future.length = 0;
  state.pages = next;
  state.unsaved = true;
  state.selected = new Set([...state.selected].filter((key) => next.some((p) => p.key === key)));
  notify();
}

/** Replaces the pages without an undo step (opening the first file). */
export function setInitial(next: Page[]): void {
  state.pages = next;
  notify();
}

export function undo(): void {
  const previous = state.past.pop();
  if (!previous) return;
  state.future.push(state.pages);
  state.pages = previous;
  state.unsaved = true;
  notify();
}

export function redo(): void {
  const next = state.future.pop();
  if (!next) return;
  state.past.push(state.pages);
  state.pages = next;
  state.unsaved = true;
  notify();
}

export function updatePage(key: string, update: (page: Page) => Page): void {
  change(state.pages.map((page) => (page.key === key ? update(page) : page)));
}

/** Text and document signals of a page in the result. */
export function textOf(page: Pick<Page, "docId" | "index">): Promise<PageText> {
  return pageText(docs.get(page.docId)!.pdf, page.index);
}
