import { button, el } from "./dom";
import { t } from "./i18n";
import { cssFont, renderCanvas, unsupportedCharacters, type RenderedPage, type Rgb, type TextEdit } from "./pdf";
import { docs, newId, state, subscribe, textOf, updatePage, type Page } from "./state";
import type { TextLine } from "./textLayer";

const ADD_SIZES = [8, 9, 10, 11, 12, 14, 16, 18];

/**
 * Text editing for one page, full screen. Click a printed line to change it,
 * or "Add text" and click where it goes. The page is shown in its own
 * orientation; turns made in the page list apply when the PDF is built.
 */
export function openPageEditor(pageKey: string, onClose: () => void): void {
  const overlay = el("div", { className: "page-editor", role: "dialog" });
  overlay.setAttribute("aria-modal", "true");
  const title = el("h2", { className: "title" });
  const hint = el("p", { className: "muted small" }, [t("editHint")]);
  const message = el("p", { className: "error", role: "alert" });
  const sizeSelect = el("select", { className: "input compact", title: t("textSize") });
  sizeSelect.setAttribute("aria-label", t("textSize"));
  for (const size of ADD_SIZES) sizeSelect.append(el("option", { value: String(size), textContent: `${size} pt` }));
  sizeSelect.value = "10";
  let adding = false;
  const addButton = button("addText", () => {
    adding = !adding;
    addButton.classList.toggle("active", adding);
    surface.classList.toggle("adding", adding);
  });
  const done = button("done", close, "button primary");
  const header = el("div", { className: "page-editor-bar" }, [
    el("div", { className: "stack tight" }, [title, hint]),
    el("span", { className: "spacer" }),
    addButton,
    sizeSelect,
    done,
  ]);
  const surface = el("div", { className: "page-surface" });
  const scroller = el("div", { className: "page-scroller" }, [surface]);
  overlay.append(header, message, scroller);
  document.body.append(overlay);
  done.focus();

  let rendered: RenderedPage | null = null;
  let lines: TextLine[] = [];
  let activeInput: HTMLInputElement | null = null;

  const page = (): Page | undefined => state.pages.find((p) => p.key === pageKey);

  function close() {
    unsubscribe();
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    onClose();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape" && !activeInput) {
      event.stopPropagation();
      close();
    }
  }
  document.addEventListener("keydown", onKey, true);

  /* Colours: the darkest pixel inside the line is the ink, the pixels just
     around it are the paper. */
  function sample(rect: [number, number, number, number]): { ink: Rgb; paper: Rgb } {
    const canvas = rendered!.canvas;
    const ratio = canvas.width / rendered!.cssWidth;
    const ctx = canvas.getContext("2d")!;
    const [l, top, r, b] = rect.map((v) => Math.round(v * ratio)) as [number, number, number, number];
    const x0 = Math.max(0, l - 2);
    const y0 = Math.max(0, top - 2);
    const w = Math.max(1, Math.min(canvas.width, r + 2) - x0);
    const h = Math.max(1, Math.min(canvas.height, b + 2) - y0);
    const data = ctx.getImageData(x0, y0, w, h).data;
    let ink: Rgb = [0, 0, 0];
    let darkest = Infinity;
    const edge: Rgb[] = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const px: Rgb = [data[i]!, data[i + 1]!, data[i + 2]!];
        const lum = px[0] * 0.299 + px[1] * 0.587 + px[2] * 0.114;
        if (lum < darkest) {
          darkest = lum;
          ink = px;
        }
        if (y === 0 || y === h - 1 || x === 0 || x === w - 1) edge.push(px);
      }
    }
    // The paper is the most common edge colour, rounded to absorb noise.
    const counts = new Map<string, { c: Rgb; n: number }>();
    for (const px of edge) {
      const k = px.map((v) => Math.round(v / 8)).join(",");
      const entry = counts.get(k) ?? { c: px, n: 0 };
      entry.n += 1;
      counts.set(k, entry);
    }
    const paper = [...counts.values()].sort((a, b2) => b2.n - a.n)[0]?.c ?? [255, 255, 255];
    // A line with no visible ink (very light) is written in black.
    if (darkest > 200) ink = [0, 0, 0];
    return { ink, paper };
  }

  function lineRect(line: TextLine): [number, number, number, number] {
    // From a little below the baseline (descenders) to a little above the caps.
    return rendered!.toScreen([line.x - 0.5, line.y - line.size * 0.25, line.x + line.width + 0.5, line.y + line.size * 0.9]);
  }

  function lineId(line: TextLine): string {
    return `r:${line.x.toFixed(1)}:${line.y.toFixed(1)}`;
  }

  function saveEdit(edit: TextEdit | null, removeId?: string) {
    updatePage(pageKey, (p) => {
      const others = p.edits.filter((e) => e.id !== (edit?.id ?? removeId));
      return { ...p, edits: edit ? [...others, edit] : others };
    });
  }

  function openInput(options: {
    left: number;
    top: number;
    width: number;
    fontPx: number;
    font: Pick<TextEdit, "family" | "bold" | "italic">;
    value: string;
    onCommit: (value: string) => void;
  }) {
    activeInput?.blur();
    const input = el("input", { className: "inline-edit", value: options.value });
    input.style.left = `${options.left}px`;
    input.style.top = `${options.top}px`;
    input.style.minWidth = `${Math.max(options.width, 60)}px`;
    input.style.font = cssFont(options.font, options.fontPx);
    input.style.height = `${Math.max(options.fontPx * 1.4, 18)}px`;
    input.setAttribute("aria-label", t("editTextLabel"));
    surface.append(input);
    activeInput = input;
    input.focus();
    input.select();
    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      if (commit) {
        const bad = unsupportedCharacters(input.value);
        if (bad.length > 0) {
          message.textContent = t("errorCharacters", bad.join(" "));
          input.focus();
          return;
        }
      }
      finished = true;
      message.textContent = "";
      activeInput = null;
      input.remove();
      if (commit) options.onCommit(input.value);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function editLine(line: TextLine) {
    const current = page()?.edits.find((e) => e.id === lineId(line));
    const rect = lineRect(line);
    const { ink, paper } = sample(rect);
    const scale = rendered!.scale;
    openInput({
      left: rect[0],
      top: rect[1] - 2,
      width: rect[2] - rect[0],
      fontPx: line.size * scale,
      font: line,
      value: current ? current.text : line.text,
      onCommit: (value) => {
        if (!current && value === line.text) return;
        saveEdit({
          id: lineId(line),
          x: line.x,
          y: line.y,
          size: line.size,
          family: line.family,
          bold: line.bold,
          italic: line.italic,
          text: value,
          color: current?.color ?? ink,
          cover: current?.cover ?? {
            x: line.x - 0.5,
            y: line.y - line.size * 0.25,
            width: line.width + 1,
            height: line.size * 1.15,
            color: paper,
          },
        });
      },
    });
  }

  function editAdded(edit: TextEdit) {
    const [left, , , bottom] = rendered!.toScreen([edit.x, edit.y, edit.x + 1, edit.y + 1]);
    const fontPx = edit.size * rendered!.scale;
    openInput({
      left,
      top: bottom - fontPx,
      width: 120,
      fontPx,
      font: edit,
      value: edit.text,
      onCommit: (value) => (value.trim() ? saveEdit({ ...edit, text: value }) : saveEdit(null, edit.id)),
    });
  }

  surface.addEventListener("click", (event) => {
    if (!adding || !rendered || event.target !== surface.querySelector("canvas")) return;
    const box = surface.getBoundingClientRect();
    const size = Number(sizeSelect.value);
    const [x, y] = rendered.toPdf(event.clientX - box.left, event.clientY - box.top + size * rendered.scale * 0.8);
    adding = false;
    addButton.classList.remove("active");
    surface.classList.remove("adding");
    editAdded({
      id: newId("a:"),
      x,
      y,
      size,
      family: "sans",
      bold: false,
      italic: false,
      text: "",
      color: [0, 0, 0],
      cover: null,
    });
  });

  function draw() {
    const current = page();
    if (!current) {
      close();
      return;
    }
    const position = state.pages.findIndex((p) => p.key === pageKey);
    title.textContent = t("editingPage", [String(position + 1), String(state.pages.length)]);
    if (!rendered) return;
    surface.querySelectorAll(".line, .edit").forEach((n) => n.remove());
    const editedIds = new Set(current.edits.map((e) => e.id));

    for (const line of lines) {
      if (editedIds.has(lineId(line))) continue;
      const [l, top, r, b] = lineRect(line);
      const box = el("button", { type: "button", className: "line", title: line.text });
      box.setAttribute("aria-label", t("editLineLabel", line.text));
      Object.assign(box.style, { left: `${l}px`, top: `${top}px`, width: `${r - l}px`, height: `${b - top}px` });
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!adding) editLine(line);
      });
      surface.append(box);
    }

    for (const edit of current.edits) {
      const fontPx = edit.size * rendered.scale;
      const node = el("button", { type: "button", className: "edit" });
      node.setAttribute("aria-label", t("editLineLabel", edit.text || t("erased")));
      if (edit.cover) {
        const [l, top, r, b] = rendered.toScreen([edit.cover.x, edit.cover.y, edit.cover.x + edit.cover.width, edit.cover.y + edit.cover.height]);
        Object.assign(node.style, {
          left: `${l}px`,
          top: `${top}px`,
          minWidth: `${r - l}px`,
          height: `${b - top}px`,
          background: `rgb(${edit.cover.color.join(",")})`,
        });
      } else {
        const [l, , , bottom] = rendered.toScreen([edit.x, edit.y, edit.x + 1, edit.y + 1]);
        Object.assign(node.style, { left: `${l}px`, top: `${bottom - fontPx * 1.05}px`, height: `${fontPx * 1.3}px` });
      }
      const label = el("span", { textContent: edit.text });
      label.style.font = cssFont(edit, fontPx);
      label.style.color = `rgb(${edit.color.join(",")})`;
      node.append(label);
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        if (adding) return;
        const line = lines.find((l) => lineId(l) === edit.id);
        if (line) editLine(line);
        else editAdded(edit);
      });
      // Undo a single change: right click.
      node.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        saveEdit(null, edit.id);
      });
      node.title = t("editRevertHint");
      surface.append(node);
    }
  }

  const unsubscribe = subscribe(draw);

  void (async () => {
    const current = page();
    if (!current) return;
    const doc = docs.get(current.docId)!;
    surface.replaceChildren(el("p", { className: "muted" }, [t("loading")]));
    draw();
    try {
      const width = Math.min(1000, window.innerWidth - 48);
      [rendered, { lines }] = await Promise.all([renderCanvas(doc.pdf, current.index, width), textOf(current)]);
    } catch {
      surface.replaceChildren(el("p", { className: "muted" }, [t("previewFailed")]));
      return;
    }
    rendered.canvas.style.width = `${rendered.cssWidth}px`;
    rendered.canvas.style.height = `${rendered.cssHeight}px`;
    surface.style.width = `${rendered.cssWidth}px`;
    surface.style.height = `${rendered.cssHeight}px`;
    surface.replaceChildren(rendered.canvas);
    if (lines.length === 0) hint.textContent = t("editNoText");
    draw();
  })();
}
