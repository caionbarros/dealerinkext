import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { removeTextInRects } from "./redact";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = chrome.runtime.getURL("pdfjs/");

export type LoadedPdf = {
  proxy: pdfjs.PDFDocumentProxy;
  pageCount: number;
};

export class PdfError extends Error {
  constructor(public code: "encrypted" | "damaged") {
    super(code);
  }
}

/** Opens a PDF for viewing. The bytes are copied: pdf.js takes ownership of what it gets. */
export async function openPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  try {
    const proxy = await pdfjs.getDocument({
      data: bytes.slice(),
      cMapUrl: `${ASSETS}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ASSETS}standard_fonts/`,
      wasmUrl: `${ASSETS}wasm/`,
      isEvalSupported: false,
      fontExtraProperties: true,
    }).promise;
    return { proxy, pageCount: proxy.numPages };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new PdfError("encrypted");
    }
    throw new PdfError("damaged");
  }
}

export type RenderedPage = {
  canvas: HTMLCanvasElement;
  /** CSS pixels per PDF unit. */
  scale: number;
  /** PDF user space rectangle to CSS pixels on the canvas: [left, top, right, bottom]. */
  toScreen: (rect: [number, number, number, number]) => [number, number, number, number];
  /** CSS pixel on the canvas to PDF user space. */
  toPdf: (x: number, y: number) => [number, number];
  cssWidth: number;
  cssHeight: number;
};

/** Draws one page at the given CSS width, in its own orientation. */
export async function renderCanvas(pdf: LoadedPdf, index: number, cssWidth: number): Promise<RenderedPage> {
  const page = await pdf.proxy.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * ratio });
  const cssViewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, canvas, viewport }).promise;
  page.cleanup();
  return {
    canvas,
    scale,
    cssWidth: cssViewport.width,
    cssHeight: cssViewport.height,
    toScreen: (rect) => {
      const [x1, y1, x2, y2] = cssViewport.convertToViewportRectangle(rect);
      return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    },
    toPdf: (x, y) => cssViewport.convertToPdfPoint(x, y) as [number, number],
  };
}

/** Draws one page as an image address. The caller revokes it when the page goes away. */
export async function renderPage(pdf: LoadedPdf, index: number, cssWidth: number): Promise<string> {
  const { canvas } = await renderCanvas(pdf, index, cssWidth);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.85),
  );
  return URL.createObjectURL(blob);
}

export type Rgb = [number, number, number];

/**
 * A change written on a page. `cover` hides what was printed there (in the
 * colour around it) before the new text is drawn. Coordinates are PDF user
 * space; x and y are the left end of the baseline.
 */
export type TextEdit = {
  id: string;
  x: number;
  y: number;
  size: number;
  family: "sans" | "serif" | "mono";
  bold: boolean;
  italic: boolean;
  text: string;
  color: Rgb;
  cover: { x: number; y: number; width: number; height: number; color: Rgb } | null;
};

/** Characters the built-in PDF fonts can write (Windows-1252). */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function unsupportedCharacters(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const ok = (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch);
    if (!ok) bad.add(ch);
  }
  return [...bad];
}

function standardFont(edit: Pick<TextEdit, "family" | "bold" | "italic">): StandardFonts {
  const { family, bold, italic } = edit;
  if (family === "serif") {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (family === "mono") {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/** CSS font for showing an edit on screen the way it will be written. */
export function cssFont(edit: Pick<TextEdit, "family" | "bold" | "italic">, px: number): string {
  const family =
    edit.family === "serif"
      ? '"Times New Roman", Times, serif'
      : edit.family === "mono"
        ? '"Courier New", Courier, monospace'
        : "Helvetica, Arial, sans-serif";
  return `${edit.italic ? "italic " : ""}${edit.bold ? "bold " : ""}${px}px ${family}`;
}

const toColor = ([r, g, b]: Rgb) => rgb(r / 255, g / 255, b / 255);

async function applyEdits(output: PDFDocument, page: PDFPage, edits: TextEdit[], fonts: Map<string, PDFFont>) {
  for (const edit of edits) {
    if (edit.cover) {
      page.drawRectangle({
        x: edit.cover.x,
        y: edit.cover.y,
        width: edit.cover.width,
        height: edit.cover.height,
        color: toColor(edit.cover.color),
        borderWidth: 0,
      });
    }
    if (!edit.text) continue;
    const name = standardFont(edit);
    let font = fonts.get(name);
    if (!font) {
      font = await output.embedFont(name);
      fonts.set(name, font);
    }
    page.drawText(edit.text, { x: edit.x, y: edit.y, size: edit.size, font, color: toColor(edit.color) });
  }
}

export type OutputPage = {
  bytesKey: string;
  index: number;
  extraRotation: number;
  edits: TextEdit[];
};

/**
 * Builds the edited PDF: optional cover first, then the pages in the given
 * order, each turned by its extra rotation and with its text edits written on
 * it. Each source file is read once and its pages copied in one go, so shared
 * fonts and images are not duplicated.
 */
export async function buildPdf(
  sources: Map<string, Uint8Array>,
  pages: OutputPage[],
  cover?: (output: PDFDocument) => Promise<void>,
): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  if (cover) await cover(output);
  const copied = new Map<string, Map<number, PDFPage>>();

  for (const [key, bytes] of sources) {
    const indices = [...new Set(pages.filter((p) => p.bytesKey === key).map((p) => p.index))];
    if (indices.length === 0) continue;
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
      if (error instanceof Error && /encrypt/i.test(error.message)) throw new PdfError("encrypted");
      throw new PdfError("damaged");
    }
    const result = await output.copyPages(source, indices);
    copied.set(key, new Map(indices.map((index, i) => [index, result[i]!])));
  }

  const fonts = new Map<string, PDFFont>();
  for (const page of pages) {
    const copy = copied.get(page.bytesKey)?.get(page.index);
    if (!copy) continue;
    const angle = (((copy.getRotation().angle + page.extraRotation) % 360) + 360) % 360;
    copy.setRotation(degrees(angle));
    if (page.edits.length > 0) {
      // A replaced line leaves the file, not only the paper.
      removeTextInRects(
        output,
        copy,
        page.edits.flatMap((edit) => (edit.cover ? [edit.cover] : [])),
      );
      await applyEdits(output, copy, page.edits, fonts);
    }
    output.addPage(copy);
  }
  return output.save();
}
