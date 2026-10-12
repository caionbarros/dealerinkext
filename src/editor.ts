import { signOut } from "./auth";
import { mountAuth } from "./authView";
import { t, translatePage } from "./i18n";
import { PdfError, buildPdf, openPdf, renderPage, type LoadedPdf } from "./pdf";
import { SourceError, fromDownload, fromFile, fromUrl, type SourceFile } from "./sources";

translatePage();

/* ------------------------------------------------------------------ model */

type Doc = { id: string; name: string; bytes: Uint8Array; pdf: LoadedPdf; color: number };
/** One page on screen. `turn` is the rotation added here, on top of the page's own. */
type Page = { key: string; docId: string; index: number; turn: number };

const docs = new Map<string, Doc>();
let pages: Page[] = [];
let selected = new Set<string>();
let anchor: string | null = null;
const past: Page[][] = [];
const future: Page[][] = [];
const HISTORY_LIMIT = 100;
/** Changes since the last download, so closing the tab can warn. */
let unsaved = false;
let busy = false;

const thumbs = new Map<string, string>(); // `${docId}:${index}` -> image address
const THUMB_WIDTH = 168;

let nextId = 1;
const newId = (prefix: string) => `${prefix}${nextId++}`;

function change(next: Page[]) {
  past.push(pages);
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  pages = next;
  unsaved = true;
  status.textContent = "";
  selected = new Set([...selected].filter((key) => pages.some((p) => p.key === key)));
  render();
}

function undo() {
  const previous = past.pop();
  if (!previous) return;
  future.push(pages);
  pages = previous;
  unsaved = true;
  render();
}

function redo() {
  const next = future.pop();
  if (!next) return;
  past.push(pages);
  pages = next;
  unsaved = true;
  render();
}

/* ------------------------------------------------------------------ dom */

const root = document.getElementById("root")!;
const account = document.getElementById("account")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function button(labelKey: string, onClick: () => void, className = "button"): HTMLButtonElement {
  const b = el("button", { type: "button", className }, [t(labelKey)]);
  b.addEventListener("click", onClick);
  return b;
}

const fileInput = el("input", { type: "file", accept: "application/pdf,.pdf", multiple: true });
fileInput.hidden = true;
fileInput.addEventListener("change", () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = "";
  void addFiles(files.map((f) => () => fromFile(f)));
});

const toolbar = el("div", { className: "toolbar", role: "toolbar" });
/** Page count and selection, always current. */
const countLine = el("p", { className: "count" });
/** Short-lived news: loading, building, downloaded. */
const status = el("p", { className: "status", role: "status" });
const grid = el("div", { className: "grid" });
const errorBox = el("div", { className: "notice error-notice", role: "alert" });
errorBox.hidden = true;

const addButton = button("addPdf", () => fileInput.click());
const rotateLeft = button("rotateLeft", () => rotate(-90));
const rotateRight = button("rotateRight", () => rotate(90));
const deleteButton = button("deletePages", () => deleteSelected());
const undoButton = button("undo", undo);
const redoButton = button("redo", redo);
const selectAllButton = button("selectAll", () => {
  selected = new Set(pages.map((p) => p.key));
  render();
});
const downloadSelection = button("downloadSelection", () => void download(true));
const downloadAll = button("downloadAll", () => void download(false), "button primary");

toolbar.append(
  addButton,
  el("span", { className: "divider" }),
  rotateLeft,
  rotateRight,
  deleteButton,
  el("span", { className: "divider" }),
  undoButton,
  redoButton,
  selectAllButton,
  el("span", { className: "spacer" }),
  downloadSelection,
  downloadAll,
);

const empty = el("div", { className: "dropzone" }, [
  el("p", { className: "title" }, [t("emptyTitle")]),
  el("p", { className: "muted" }, [t("emptyBody")]),
  button("chooseFile", () => fileInput.click(), "button primary"),
]);

function showError(message: string | null) {
  errorBox.hidden = !message;
  errorBox.textContent = message ?? "";
}

function errorMessage(error: unknown): string {
  if (error instanceof SourceError) {
    return {
      file_access: t("errorFileAccess"),
      unreachable: t("errorUnreachable"),
      not_pdf: t("errorNotPdf"),
      download_missing: t("errorDownloadMissing"),
    }[error.code];
  }
  if (error instanceof PdfError) {
    return error.code === "encrypted" ? t("errorEncrypted") : t("errorDamaged");
  }
  return t("errorUnknown");
}

/* --------------------------------------------------------------- loading */

async function addFiles(loaders: (() => Promise<SourceFile>)[], at = pages.length) {
  if (loaders.length === 0) return;
  showError(null);
  busy = true;
  status.textContent = t("loading");
  render();
  const added: Page[] = [];
  const failures: string[] = [];
  for (const load of loaders) {
    try {
      const file = await load();
      const pdf = await openPdf(file.bytes);
      const doc: Doc = { id: newId("d"), name: file.name, bytes: file.bytes, pdf, color: docs.size % 6 };
      docs.set(doc.id, doc);
      for (let index = 0; index < pdf.pageCount; index += 1) {
        added.push({ key: newId("p"), docId: doc.id, index, turn: 0 });
      }
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }
  busy = false;
  status.textContent = "";
  if (added.length > 0) {
    const first = pages.length === 0;
    const next = [...pages.slice(0, at), ...added, ...pages.slice(at)];
    if (first) {
      // Opening the first file is not an edit: nothing to undo, nothing unsaved.
      pages = next;
    } else {
      change(next);
    }
  }
  showError(failures.length > 0 ? [...new Set(failures)].join(" ") : null);
  render();
}

/* --------------------------------------------------------------- actions */

function targets(): Set<string> {
  return selected.size > 0 ? selected : new Set<string>();
}

function rotate(by: number) {
  const keys = targets();
  if (keys.size === 0) return;
  change(pages.map((p) => (keys.has(p.key) ? { ...p, turn: (p.turn + by + 360) % 360 } : p)));
}

function deleteSelected() {
  const keys = targets();
  if (keys.size === 0) return;
  change(pages.filter((p) => !keys.has(p.key)));
  selected = new Set();
  render();
}

/** Moves the selected pages so they start right before `beforeKey` (null: the end). */
function moveSelected(beforeKey: string | null) {
  const moving = pages.filter((p) => selected.has(p.key));
  if (moving.length === 0) return;
  if (beforeKey && selected.has(beforeKey)) return;
  const rest = pages.filter((p) => !selected.has(p.key));
  const at = beforeKey ? rest.findIndex((p) => p.key === beforeKey) : rest.length;
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  if (next.every((p, i) => p.key === pages[i]?.key)) return;
  change(next);
}

function outputName(selection: boolean): string {
  // Named after the first file opened that still has pages in the result.
  const used = new Set(pages.map((p) => p.docId));
  const first = [...docs.values()].find((doc) => used.has(doc.id));
  const base = (first?.name ?? "document.pdf").replace(/\.pdf$/i, "");
  const suffix = selection ? t("suffixSelection") : t("suffixEdited");
  return `${base}-${suffix}.pdf`.replace(/[\\/:*?"<>|]+/g, "_");
}

async function download(selection: boolean) {
  const chosen = selection ? pages.filter((p) => selected.has(p.key)) : pages;
  if (chosen.length === 0 || busy) return;
  busy = true;
  showError(null);
  status.textContent = t("building");
  render();
  try {
    const sources = new Map<string, Uint8Array>();
    for (const p of chosen) sources.set(p.docId, docs.get(p.docId)!.bytes);
    const bytes = await buildPdf(
      sources,
      chosen.map((p) => ({ bytesKey: p.docId, index: p.index, extraRotation: p.turn })),
    );
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    await chrome.downloads.download({ url, filename: outputName(selection), saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (!selection) unsaved = false;
    status.textContent = t("downloaded");
  } catch (error) {
    // Closing the "Save as" window is not an error.
    if (!(error instanceof Error && /cancel/i.test(error.message))) {
      showError(errorMessage(error));
    }
    status.textContent = "";
  } finally {
    busy = false;
    render();
  }
}

/* -------------------------------------------------------------- thumbnails */

const renderQueue: { doc: Doc; index: number; resolve: (url: string | null) => void }[] = [];
let rendering = 0;

function pump() {
  while (rendering < 2 && renderQueue.length > 0) {
    const job = renderQueue.shift()!;
    rendering += 1;
    renderPage(job.doc.pdf, job.index, THUMB_WIDTH)
      .then(job.resolve, () => job.resolve(null))
      .finally(() => {
        rendering -= 1;
        pump();
      });
  }
}

function thumbnail(doc: Doc, index: number): Promise<string | null> {
  const cached = thumbs.get(`${doc.id}:${index}`);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    renderQueue.push({
      doc,
      index,
      resolve: (url) => {
        if (url) thumbs.set(`${doc.id}:${index}`, url);
        resolve(url);
      },
    });
    pump();
  });
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target as HTMLImageElement;
      observer.unobserve(img);
      const doc = docs.get(img.dataset.doc!);
      if (!doc) continue;
      void thumbnail(doc, Number(img.dataset.index)).then((url) => {
        if (url) img.src = url;
        else img.alt = t("previewFailed");
      });
    }
  },
  { rootMargin: "600px" },
);

/* ---------------------------------------------------------------- preview */

const preview = el("div", { className: "preview", role: "dialog" });
preview.hidden = true;
preview.addEventListener("click", () => (preview.hidden = true));

async function openPreview(page: Page) {
  const doc = docs.get(page.docId)!;
  preview.replaceChildren(el("p", { className: "muted" }, [t("loading")]));
  preview.hidden = false;
  try {
    const url = await renderPage(doc.pdf, page.index, 900);
    const img = el("img", { src: url, alt: "" });
    img.style.transform = `rotate(${page.turn}deg)`;
    img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
    preview.replaceChildren(img);
  } catch {
    preview.replaceChildren(el("p", { className: "muted" }, [t("previewFailed")]));
  }
}

/* --------------------------------------------------------------- drag/drop */

let dropBefore: string | null | undefined; // undefined: no drop target shown

function clearDropMarks() {
  grid.querySelectorAll(".drop-before, .drop-after").forEach((n) =>
    n.classList.remove("drop-before", "drop-after"),
  );
}

grid.addEventListener("dragover", (event) => {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes("application/x-dealerink-pages") && !types.includes("Files")) return;
  event.preventDefault();
  const card = (event.target as HTMLElement).closest<HTMLElement>(".card");
  clearDropMarks();
  if (!card) {
    dropBefore = null;
    return;
  }
  const box = card.getBoundingClientRect();
  const after = event.clientX > box.left + box.width / 2;
  card.classList.add(after ? "drop-after" : "drop-before");
  if (after) {
    const i = pages.findIndex((p) => p.key === card.dataset.key);
    dropBefore = pages[i + 1]?.key ?? null;
  } else {
    dropBefore = card.dataset.key ?? null;
  }
});

grid.addEventListener("dragleave", (event) => {
  if (!grid.contains(event.relatedTarget as Node)) clearDropMarks();
});

grid.addEventListener("drop", (event) => {
  event.preventDefault();
  clearDropMarks();
  const before = dropBefore ?? null;
  dropBefore = undefined;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length > 0) {
    const at = before ? pages.findIndex((p) => p.key === before) : pages.length;
    void addFiles(files.map((f) => () => fromFile(f)), at);
    return;
  }
  moveSelected(before);
});

// Files dropped anywhere else on the page are added at the end, never opened by Chrome.
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();
  if (grid.contains(event.target as Node)) return;
  const files = [...(event.dataTransfer?.files ?? [])];
  void addFiles(files.map((f) => () => fromFile(f)));
});

/* ----------------------------------------------------------------- render */

function select(key: string, event: MouseEvent | KeyboardEvent) {
  if (event.shiftKey && anchor) {
    const a = pages.findIndex((p) => p.key === anchor);
    const b = pages.findIndex((p) => p.key === key);
    const [from, to] = a < b ? [a, b] : [b, a];
    selected = new Set(pages.slice(from, to + 1).map((p) => p.key));
  } else if (event.ctrlKey || event.metaKey) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
    anchor = key;
  } else {
    selected = new Set([key]);
    anchor = key;
  }
  render();
}

function card(page: Page, position: number): HTMLElement {
  const doc = docs.get(page.docId)!;
  const img = el("img", { alt: "", draggable: false });
  img.dataset.doc = doc.id;
  img.dataset.index = String(page.index);
  img.style.transform = `rotate(${page.turn}deg)`;
  const cached = thumbs.get(`${doc.id}:${page.index}`);
  if (cached) img.src = cached;
  else observer.observe(img);

  const label = t("pageLabel", [String(position + 1)]);
  const node = el(
    "div",
    {
      className: `card color-${doc.color}${selected.has(page.key) ? " selected" : ""}`,
      draggable: true,
      tabIndex: 0,
      title: docs.size > 1 ? `${doc.name}, ${t("sourcePage", [String(page.index + 1)])}` : label,
    },
    [
      el("div", { className: "frame" }, [img]),
      el("span", { className: "number" }, [String(position + 1)]),
    ],
  );
  node.setAttribute("role", "option");
  node.setAttribute("aria-selected", String(selected.has(page.key)));
  node.setAttribute("aria-label", label);
  node.dataset.key = page.key;
  node.addEventListener("click", (event) => select(page.key, event));
  node.addEventListener("dblclick", () => void openPreview(page));
  node.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (event.key === "Enter") void openPreview(page);
      else select(page.key, event);
    }
  });
  node.addEventListener("dragstart", (event) => {
    if (!selected.has(page.key)) {
      selected = new Set([page.key]);
      anchor = page.key;
      grid.querySelectorAll(".card.selected").forEach((n) => n.classList.remove("selected"));
      node.classList.add("selected");
    }
    event.dataTransfer?.setData("application/x-dealerink-pages", [...selected].join(","));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  return node;
}

function render() {
  const hasPages = pages.length > 0;
  const hasSelection = selected.size > 0;
  for (const b of [rotateLeft, rotateRight, deleteButton, downloadSelection]) {
    b.disabled = busy || !hasSelection;
  }
  undoButton.disabled = busy || past.length === 0;
  redoButton.disabled = busy || future.length === 0;
  selectAllButton.disabled = busy || !hasPages;
  downloadAll.disabled = busy || !hasPages;
  addButton.disabled = busy;

  countLine.textContent = !hasPages
    ? ""
    : hasSelection
      ? t("countSelected", [String(selected.size), String(pages.length)])
      : t("countPages", [String(pages.length)]);

  if (!hasPages) {
    grid.replaceChildren();
    empty.hidden = busy;
    return;
  }
  empty.hidden = true;
  grid.setAttribute("role", "listbox");
  grid.setAttribute("aria-multiselectable", "true");
  grid.setAttribute("aria-label", t("pagesLabel"));
  grid.classList.toggle("multi", new Set(pages.map((p) => p.docId)).size > 1);
  grid.replaceChildren(...pages.map(card));
}

document.addEventListener("keydown", (event) => {
  if (!preview.hidden) {
    if (event.key === "Escape") preview.hidden = true;
    return;
  }
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea")) return;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
  } else if (mod && event.key.toLowerCase() === "a") {
    event.preventDefault();
    selected = new Set(pages.map((p) => p.key));
    render();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  } else if (event.key === "Escape") {
    selected = new Set();
    render();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (unsaved && pages.length > 0) event.preventDefault();
});

/* ------------------------------------------------------------------ start */

function startEditor(email: string) {
  const out = el("button", { type: "button", className: "button text" }, [t("signOut")]);
  out.addEventListener("click", async () => {
    await signOut();
    window.location.reload();
  });
  account.replaceChildren(el("span", { className: "muted small" }, [email]), out);

  root.replaceChildren(
    toolbar,
    el("div", { className: "statusbar" }, [countLine, status]),
    errorBox,
    empty,
    grid,
    preview,
    fileInput,
  );
  root.classList.add("workspace");

  const params = new URLSearchParams(window.location.search);
  const src = params.get("src");
  const downloadId = params.get("download");
  render();
  if (src) void addFiles([() => fromUrl(src)]);
  else if (downloadId) void addFiles([() => fromDownload(Number(downloadId))]);
}

void mountAuth(root, (access) => startEditor(access.email));
