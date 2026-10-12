import { PDFDocument, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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
    }).promise;
    return { proxy, pageCount: proxy.numPages };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new PdfError("encrypted");
    }
    throw new PdfError("damaged");
  }
}

/**
 * Draws one page at the given width (CSS pixels) in its own orientation and
 * returns an image address. The caller revokes it when the page goes away.
 */
export async function renderPage(pdf: LoadedPdf, index: number, cssWidth: number): Promise<string> {
  const page = await pdf.proxy.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: (cssWidth * ratio) / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false })!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, canvas, viewport }).promise;
  page.cleanup();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.85),
  );
  return URL.createObjectURL(blob);
}

export type OutputPage = { bytesKey: string; index: number; extraRotation: number };

/**
 * Builds the edited PDF: pages in the given order, each turned by its extra
 * rotation on top of its own. Each source file is read once and its pages are
 * copied in one go, so shared fonts and images are not duplicated.
 */
export async function buildPdf(
  sources: Map<string, Uint8Array>,
  pages: OutputPage[],
): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  const copied = new Map<string, Map<number, Awaited<ReturnType<PDFDocument["copyPages"]>>[number]>>();

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

  for (const page of pages) {
    const copy = copied.get(page.bytesKey)?.get(page.index);
    if (!copy) continue;
    const angle = (((copy.getRotation().angle + page.extraRotation) % 360) + 360) % 360;
    copy.setRotation(degrees(angle));
    output.addPage(copy);
  }
  return output.save();
}
