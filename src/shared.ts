/** Tabs currently showing a PDF: tab id to the PDF's address. */
export type PdfTabs = Record<number, string>;

/** A PDF by its address: "file.pdf", "file.pdf?x=1", "file.pdf#page=2". */
export function isPdfUrl(url: string): boolean {
  try {
    const { protocol, pathname } = new URL(url);
    if (!["http:", "https:", "file:"].includes(protocol)) return false;
    return /\.pdf$/i.test(pathname);
  } catch {
    return false;
  }
}

/** The editor page, opened on an address, a finished download or nothing. */
export function editorUrl(source: { src?: string; download?: string } = {}): string {
  const params = new URLSearchParams();
  if (source.src) params.set("src", source.src);
  if (source.download) params.set("download", source.download);
  const query = params.toString();
  return chrome.runtime.getURL(`editor.html${query ? `?${query}` : ""}`);
}
