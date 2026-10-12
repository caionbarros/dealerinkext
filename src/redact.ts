import {
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFDocument,
  type PDFPage,
} from "pdf-lib";

/** A rectangle in PDF user space: x, y (bottom left), width, height. */
export type Rect = { x: number; y: number; width: number; height: number };

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

type Token = { kind: "num" | "str" | "hex" | "name" | "op" | "open" | "close" | "dict"; value: string; start: number; end: number };

const WHITE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set("()<>[]{}/%".split("").map((c) => c.charCodeAt(0)));

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (WHITE.has(c)) {
      i += 1;
      continue;
    }
    const start = i;
    const ch = src[i]!;
    if (ch === "%") {
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i += 1;
      continue;
    }
    if (ch === "(") {
      let depth = 1;
      i += 1;
      while (i < n && depth > 0) {
        const d = src[i]!;
        if (d === "\\") i += 2;
        else {
          if (d === "(") depth += 1;
          else if (d === ")") depth -= 1;
          i += 1;
        }
      }
      if (depth !== 0) return null;
      out.push({ kind: "str", value: "", start, end: i });
      continue;
    }
    if (ch === "<") {
      if (src[i + 1] === "<") {
        out.push({ kind: "dict", value: "<<", start, end: i + 2 });
        i += 2;
        continue;
      }
      const close = src.indexOf(">", i);
      if (close < 0) return null;
      i = close + 1;
      out.push({ kind: "hex", value: "", start, end: i });
      continue;
    }
    if (ch === ">") {
      if (src[i + 1] !== ">") return null;
      out.push({ kind: "dict", value: ">>", start, end: i + 2 });
      i += 2;
      continue;
    }
    if (ch === "[" || ch === "]") {
      out.push({ kind: ch === "[" ? "open" : "close", value: ch, start, end: i + 1 });
      i += 1;
      continue;
    }
    if (ch === "{" || ch === "}") {
      i += 1;
      continue;
    }
    if (ch === "/") {
      i += 1;
      while (i < n && !WHITE.has(src.charCodeAt(i)) && !DELIM.has(src.charCodeAt(i))) i += 1;
      out.push({ kind: "name", value: src.slice(start, i), start, end: i });
      continue;
    }
    while (i < n && !WHITE.has(src.charCodeAt(i)) && !DELIM.has(src.charCodeAt(i))) i += 1;
    const word = src.slice(start, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) out.push({ kind: "num", value: word, start, end: i });
    else {
      // Inline images carry raw bytes this reader does not walk through safely.
      if (word === "BI") return null;
      out.push({ kind: "op", value: word, start, end: i });
    }
    if (i === start) return null;
  }
  return out;
}

const inside = (x: number, y: number, r: Rect) =>
  x >= r.x - 0.5 && x <= r.x + r.width + 0.5 && y >= r.y - 0.5 && y <= r.y + r.height + 0.5;

/**
 * Removes from the page's own content the text whose starting point falls
 * inside one of the rectangles, so a replaced line is gone from the file, not
 * only hidden behind the new one.
 *
 * It errs on the side of leaving text in place: text drawn right after other
 * text without a new position (its start is not known exactly), text inside
 * embedded forms, and pages with inline images are left alone. The white
 * cover still hides those on paper.
 */
export function removeTextInRects(output: PDFDocument, page: PDFPage, rects: Rect[]): void {
  if (rects.length === 0) return;
  const contents = page.node.Contents();
  if (!contents) return;
  const refs: PDFRef[] = [];
  const streams: PDFRawStream[] = [];
  const collect = (value: unknown) => {
    const stream = value instanceof PDFRef ? output.context.lookup(value) : value;
    if (stream instanceof PDFRawStream) streams.push(stream);
    if (value instanceof PDFRef) refs.push(value);
  };
  if (contents instanceof PDFArray) for (let i = 0; i < contents.size(); i += 1) collect(contents.get(i));
  else collect(contents);
  if (streams.length === 0) return;

  let source: string;
  try {
    source = streams
      .map((s) => {
        const bytes = decodePDFRawStream(s).decode();
        let text = "";
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return text;
      })
      .join("\n");
  } catch {
    return;
  }
  const tokens = tokenize(source);
  if (!tokens) return;

  // Walk the operators, keeping the graphics and text matrices.
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let leading = 0;
  let known = false; // the start of the next text is exactly known
  const blank: { start: number; end: number; replacement: string }[] = [];
  let operands: Token[] = [];

  const nums = () => operands.filter((t) => t.kind === "num").map((t) => Number(t.value));
  const moveTo = (tx: number, ty: number) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
    known = true;
  };
  const show = (strings: Token[], arrayTokens: { open: Token; close: Token } | null) => {
    if (known) {
      const origin = multiply(tm, ctm);
      if (rects.some((r) => inside(origin[4], origin[5], r))) {
        if (arrayTokens) blank.push({ start: arrayTokens.open.start, end: arrayTokens.close.end, replacement: "[]" });
        else for (const s of strings) blank.push({ start: s.start, end: s.end, replacement: "()" });
      }
    }
    // The text advanced by a width this reader does not compute.
    known = false;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind !== "op") {
      operands.push(token);
      continue;
    }
    const v = nums();
    switch (token.value) {
      case "q":
        stack.push(ctm);
        break;
      case "Q":
        ctm = stack.pop() ?? IDENTITY;
        break;
      case "cm":
        if (v.length >= 6) ctm = multiply(v.slice(-6) as Matrix, ctm);
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        known = true;
        break;
      case "Tm":
        if (v.length >= 6) {
          tm = v.slice(-6) as Matrix;
          tlm = tm;
          known = true;
        }
        break;
      case "Td":
        if (v.length >= 2) moveTo(v[v.length - 2]!, v[v.length - 1]!);
        break;
      case "TD":
        if (v.length >= 2) {
          leading = -v[v.length - 1]!;
          moveTo(v[v.length - 2]!, v[v.length - 1]!);
        }
        break;
      case "TL":
        if (v.length >= 1) leading = v[v.length - 1]!;
        break;
      case "T*":
        moveTo(0, -leading);
        break;
      case "Tj":
        show(operands.filter((t) => t.kind === "str" || t.kind === "hex").slice(-1), null);
        break;
      case "'":
      case '"':
        moveTo(0, -leading);
        show(operands.filter((t) => t.kind === "str" || t.kind === "hex").slice(-1), null);
        break;
      case "TJ": {
        const open = [...operands].reverse().find((t) => t.kind === "open");
        const close = [...operands].reverse().find((t) => t.kind === "close");
        if (open && close) show([], { open, close });
        else known = false;
        break;
      }
      default:
        break;
    }
    operands = [];
  }
  if (blank.length === 0) return;

  blank.sort((a, b) => a.start - b.start);
  let result = "";
  let at = 0;
  for (const b of blank) {
    if (b.start < at) continue;
    result += source.slice(at, b.start) + b.replacement;
    at = b.end;
  }
  result += source.slice(at);
  const bytes = new Uint8Array(result.length);
  for (let i = 0; i < result.length; i += 1) bytes[i] = result.charCodeAt(i) & 0xff;
  const stream = output.context.flateStream(bytes);
  page.node.set(PDFName.of("Contents"), output.context.register(stream));
}
