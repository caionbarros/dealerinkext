/** Getting the bytes of a PDF from wherever the person found it. */

export type SourceFile = { name: string; bytes: Uint8Array };

export type SourceErrorCode =
  | "file_access" // a file on disk, and Chrome does not let the extension read files
  | "unreachable" // the site refused or the network failed
  | "not_pdf" // what came back is not a PDF (often a sign-in page)
  | "download_missing"; // the download was deleted or moved

export class SourceError extends Error {
  constructor(public code: SourceErrorCode) {
    super(code);
  }
}

function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF" may follow a few bytes of junk; readers accept it within the first 1 KB.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF");
}

function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // fall through
  }
  return "document.pdf";
}

function nameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

export async function fromUrl(url: string): Promise<SourceFile> {
  if (url.startsWith("file:")) {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    if (!allowed) throw new SourceError("file_access");
  }
  let response: Response;
  try {
    // The person's own sign-in to the dealer system goes along, as when Chrome opened it.
    response = await fetch(url, { credentials: "include" });
  } catch {
    throw new SourceError(url.startsWith("file:") ? "file_access" : "unreachable");
  }
  if (!response.ok && !url.startsWith("file:")) throw new SourceError("unreachable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!looksLikePdf(bytes)) throw new SourceError("not_pdf");
  const name = nameFromDisposition(response.headers.get("content-disposition")) ?? nameFromUrl(url);
  return { name, bytes };
}

/**
 * A finished download: read from disk when Chrome allows it, otherwise fetched
 * again from where it came from.
 */
export async function fromDownload(id: number): Promise<SourceFile> {
  const [item] = await chrome.downloads.search({ id });
  if (!item || !item.exists) throw new SourceError("download_missing");
  const name = item.filename.split(/[\\/]/).pop() ?? "document.pdf";
  if (await chrome.extension.isAllowedFileSchemeAccess()) {
    const path = item.filename.replace(/\\/g, "/");
    const encoded = path
      .split("/")
      .map((part) => (/^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
      .join("/");
    const fileUrl = `file://${path.startsWith("/") ? "" : "/"}${encoded}`;
    try {
      const file = await fromUrl(fileUrl);
      return { ...file, name };
    } catch {
      // try the original address below
    }
  }
  const origin = item.finalUrl || item.url;
  if (!origin || origin.startsWith("blob:") || origin.startsWith("data:")) {
    throw new SourceError("file_access");
  }
  const file = await fromUrl(origin);
  return { ...file, name };
}

export async function fromFile(file: File): Promise<SourceFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) throw new SourceError("not_pdf");
  return { name: file.name, bytes };
}
