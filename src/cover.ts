import { StandardFonts, rgb, type PDFDocument, type PDFFont } from "pdf-lib";

import { unsupportedCharacters } from "./pdf";

/** What the dealer fills in for the cover. Every field is optional. */
export type CoverData = {
  dealerName: string;
  dealerAddress: string;
  dealerPhone: string;
  buyer: string;
  coBuyer: string;
  vehicle: string;
  vin: string;
  stockNumber: string;
  dealNumber: string;
  lender: string;
  contractDate: string;
  notes: string;
};

export const EMPTY_COVER: CoverData = {
  dealerName: "",
  dealerAddress: "",
  dealerPhone: "",
  buyer: "",
  coBuyer: "",
  vehicle: "",
  vin: "",
  stockNumber: "",
  dealNumber: "",
  lender: "",
  contractDate: "",
  notes: "",
};

/** The dealer's own fields, remembered between packages. */
export const DEALER_FIELDS = ["dealerName", "dealerAddress", "dealerPhone"] as const;

export type CoverEntry = { name: string; firstPage: number; lastPage: number };

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const RULE = rgb(0.8, 0.84, 0.88);

/** Built-in fonts write Windows-1252 only; anything else becomes "?". */
function safe(text: string): string {
  let out = text;
  for (const ch of unsupportedCharacters(text)) out = out.split(ch).join("?");
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/).map(safe)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * A one-page US Letter cover, in English because it goes to a US lender:
 * dealership, deal, vehicle, then the list of documents with their pages.
 * Page numbers count the cover as page 1.
 */
export async function drawCover(output: PDFDocument, data: CoverData, entries: CoverEntry[]): Promise<void> {
  const page = output.addPage([612, 792]);
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const left = 54;
  const right = 612 - 54;
  const width = right - left;
  let y = 792 - 64;

  const text = (value: string, x: number, size: number, font = regular, color = INK) =>
    page.drawText(safe(value), { x, y, size, font, color });

  // Dealership block.
  if (data.dealerName) {
    text(data.dealerName, left, 18, bold);
    y -= 20;
  }
  for (const line of wrap([data.dealerAddress, data.dealerPhone].filter(Boolean).join("\n"), regular, 10, width)) {
    if (!line) continue;
    text(line, left, 10, regular, MUTED);
    y -= 13;
  }
  y -= 18;
  text("FUNDING PACKAGE", left, 22, bold);
  y -= 12;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: RULE });
  y -= 24;

  // Deal details in two columns.
  const rows: [string, string][] = (
    [
      ["Buyer", data.buyer],
      ["Co-buyer", data.coBuyer],
      ["Vehicle", data.vehicle],
      ["VIN", data.vin],
      ["Stock #", data.stockNumber],
      ["Deal #", data.dealNumber],
      ["Lender", data.lender],
      ["Contract date", data.contractDate],
    ] as [string, string][]
  ).filter(([, value]) => value.trim());
  for (const [label, value] of rows) {
    text(label.toUpperCase(), left, 8, bold, MUTED);
    for (const line of wrap(value, regular, 11, width - 120)) {
      page.drawText(line, { x: left + 120, y, size: 11, font: regular, color: INK });
      y -= 15;
    }
    y -= 3;
  }
  if (rows.length > 0) y -= 10;

  // Contents.
  text("DOCUMENTS ENCLOSED", left, 9, bold, MUTED);
  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: RULE });
  y -= 16;
  entries.forEach((entry, i) => {
    if (y < 90) return;
    const pages = entry.firstPage === entry.lastPage ? `${entry.firstPage}` : `${entry.firstPage}-${entry.lastPage}`;
    text(`${i + 1}.`, left, 11, regular, MUTED);
    text(entry.name, left + 22, 11);
    const label = `p. ${pages}`;
    page.drawText(label, { x: right - regular.widthOfTextAtSize(label, 11), y, size: 11, font: regular, color: MUTED });
    y -= 17;
  });

  if (data.notes.trim() && y > 110) {
    y -= 12;
    text("NOTES", left, 9, bold, MUTED);
    y -= 15;
    for (const line of wrap(data.notes, regular, 10, width)) {
      if (y < 60) break;
      text(line, left, 10);
      y -= 13;
    }
  }
}
