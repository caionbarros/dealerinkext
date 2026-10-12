import type { LoadedPdf } from "./pdf";
import {
  detectDocTypeMatch,
  detectFormCode,
  detectPageMarker,
  hasContinuationMarker,
} from "./dealer/docPatterns";
import type { PageSignals } from "./dealer/documentGrouping";

/** One line of text as printed, in PDF user space (origin bottom left). */
export type TextLine = {
  text: string;
  /** Left edge and baseline. */
  x: number;
  y: number;
  width: number;
  size: number;
  family: "sans" | "serif" | "mono";
  bold: boolean;
  italic: boolean;
};

export type PageText = {
  lines: TextLine[];
  fullText: string;
  signals: Omit<PageSignals, "index">;
};

type RawItem = {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
  hasEOL?: boolean;
};

function styleOf(fontName: string, generic: string): Pick<TextLine, "family" | "bold" | "italic"> {
  const name = fontName.replace(/^[A-Z]{6}\+/, "");
  const family: TextLine["family"] = /courier|mono|consol/i.test(name) || generic === "monospace"
    ? "mono"
    : /times|serif|roman|georgia|garamond|book/i.test(name) && !/sans/i.test(name)
      ? "serif"
      : generic === "serif"
        ? "serif"
        : "sans";
  return {
    family,
    bold: /bold|black|heavy|semibold|demi/i.test(name),
    italic: /italic|oblique/i.test(name),
  };
}

const cache = new WeakMap<LoadedPdf, Map<number, Promise<PageText>>>();

/** Text lines and the document signals of one page. Read once per page. */
export function pageText(pdf: LoadedPdf, index: number): Promise<PageText> {
  let byPage = cache.get(pdf);
  if (!byPage) {
    byPage = new Map();
    cache.set(pdf, byPage);
  }
  let result = byPage.get(index);
  if (!result) {
    result = readPageText(pdf, index);
    byPage.set(index, result);
  }
  return result;
}

async function readPageText(pdf: LoadedPdf, index: number): Promise<PageText> {
  const page = await pdf.proxy.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  let items: RawItem[] = [];
  let styles: Record<string, { fontFamily: string }> = {};
  try {
    // Loading the drawing instructions also loads the fonts, so their real
    // names (Arial-BoldMT, TimesNewRoman...) are known below.
    await page.getOperatorList();
    const content = await page.getTextContent();
    items = content.items.filter((item) => "str" in item) as unknown as RawItem[];
    styles = content.styles as Record<string, { fontFamily: string }>;
  } catch {
    items = [];
  }

  const realName = (id: string): string => {
    try {
      const font = page.commonObjs.get(id) as { name?: string } | undefined;
      return font?.name ?? id;
    } catch {
      return id;
    }
  };

  // Horizontal text only; rotated or skewed text is not offered for editing.
  const pieces = items
    .filter((item) => item.str.length > 0 && Math.abs(item.transform[1]!) < 1e-3 && Math.abs(item.transform[2]!) < 1e-3)
    .map((item) => {
      const size = Math.abs(item.transform[3]!) || Math.abs(item.transform[0]!);
      return {
        text: item.str,
        x: item.transform[4]!,
        y: item.transform[5]!,
        width: item.width,
        size,
        font: item.fontName,
        eol: !!item.hasEOL,
        ...styleOf(realName(item.fontName), styles[item.fontName]?.fontFamily ?? ""),
      };
    });

  // Joins neighbouring pieces of the same line and font into one editable line.
  const lines: TextLine[] = [];
  let current: (TextLine & { font: string; end: number }) | null = null;
  for (const piece of pieces) {
    const sameLine =
      current &&
      current.font === piece.font &&
      Math.abs(current.y - piece.y) < piece.size * 0.3 &&
      Math.abs(current.size - piece.size) < 0.5 &&
      piece.x >= current.end - piece.size * 0.3 &&
      piece.x - current.end < piece.size * 1.2;
    if (current && sameLine) {
      const gap = piece.x - current.end;
      const needsSpace = gap > piece.size * 0.15 && !current.text.endsWith(" ") && !piece.text.startsWith(" ");
      current.text += (needsSpace ? " " : "") + piece.text;
      current.end = piece.x + piece.width;
      current.width = current.end - current.x;
    } else {
      if (current) lines.push(current);
      current = {
        text: piece.text,
        x: piece.x,
        y: piece.y,
        width: piece.width,
        size: piece.size,
        family: piece.family,
        bold: piece.bold,
        italic: piece.italic,
        font: piece.font,
        end: piece.x + piece.width,
      };
    }
    if (piece.eol && current) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);
  const cleanLines = lines
    .map(({ text, x, y, width, size, family, bold, italic }) => ({
      text: text.replace(/\s+$/, ""),
      x,
      y,
      width,
      size,
      family,
      bold,
      italic,
    }))
    .filter((line) => line.text.trim().length > 0 && line.width > 0);

  // Document signals, read the same way DealerInk reads them.
  let fullText = "";
  let topText = "";
  let headText = "";
  let footText = "";
  const height = viewport.height;
  for (const item of items) {
    const y = item.transform[5] ?? 0;
    fullText += `${item.str} `;
    if (y >= height * 0.72) topText += `${item.str} `;
    if (y >= height * 0.9) headText += `${item.str} `;
    if (y <= height * 0.1) footText += `${item.str} `;
  }
  const hasText = fullText.trim().length > 12;
  const match = hasText ? detectDocTypeMatch(topText) : null;
  page.cleanup();
  return {
    lines: cleanLines,
    fullText,
    signals: {
      hasText,
      docType: match?.type ?? null,
      patternId: match?.patternId ?? null,
      continuation: hasText ? hasContinuationMarker(topText) : false,
      formCode: hasText ? detectFormCode(`${headText} ${footText}`) : null,
      pageMarker: hasText
        ? (detectPageMarker(footText) ?? detectPageMarker(headText) ?? detectPageMarker(topText))
        : null,
    },
  };
}

/** The vehicle VIN printed most often in the text, if any. */
export function findVin(texts: string[]): string | null {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const match of text.toUpperCase().matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/g)) {
      const vin = match[0];
      if (!/[0-9]/.test(vin) || !/[A-Z]/.test(vin)) continue;
      counts.set(vin, (counts.get(vin) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [vin, count] of counts) {
    if (count > bestCount) {
      best = vin;
      bestCount = count;
    }
  }
  return best;
}
