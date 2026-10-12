import type { DocType } from "./docPatterns";

/**
 * What the reader detected on one page. No text, ever: only the code, the
 * marker numbers and the id of the title pattern that matched.
 */
export type PageSignals = {
  index: number;
  hasText: boolean;
  docType: DocType | null;
  patternId: string | null;
  formCode: string | null;
  pageMarker: { page: number; of: number | null } | null;
  continuation: boolean;
};

export type DocGroup<T extends PageSignals> = {
  docType: DocType;
  /** Which signal decided the split: a = form code, b = page marker, c = title. */
  startedBy: "code" | "marker" | "title" | "first" | "scan";
  /** "Page N of M" told us how long the form is, when it was printed. */
  expectedPages: number | null;
  pages: T[];
};

/**
 * Splits a package into documents using three signals, in this order:
 * a) the form code printed in the header or the footer,
 * b) the "Page N of M" marker,
 * c) the title patterns.
 * Any of them may be missing; whichever exists first decides.
 */
export function groupPages<T extends PageSignals>(pages: T[]): Array<DocGroup<T>> {
  const ordered = [...pages].sort((a, b) => a.index - b.index);
  const groups: Array<DocGroup<T> & { code: string | null }> = [];

  for (const page of ordered) {
    const last = groups.at(-1);
    const type: DocType = page.hasText ? (page.docType ?? "other") : "scanned_document";

    const start = (startedBy: DocGroup<T>["startedBy"]) => {
      groups.push({
        docType: type,
        startedBy,
        expectedPages: page.pageMarker?.of ?? null,
        pages: [page],
        code: page.formCode,
      });
    };
    const keep = () => {
      if (!last) return;
      last.pages.push(page);
      if (last.expectedPages == null && page.pageMarker?.of != null) {
        last.expectedPages = page.pageMarker.of;
      }
      // A later page may name the form the first page did not.
      if (last.docType === "other" && type !== "other" && type !== "scanned_document") {
        last.docType = type;
      }
      if (!last.code && page.formCode) last.code = page.formCode;
    };

    if (!last) {
      start("first");
      continue;
    }

    // A page with no text layer is a scan: it only joins other scans.
    if (!page.hasText) {
      if (last.docType === "scanned_document") keep();
      else start("scan");
      continue;
    }

    // a) FORM CODE wins over everything else.
    if (page.formCode && last.code) {
      if (page.formCode === last.code) keep();
      else start("code");
      continue;
    }

    // b) PAGE MARKER.
    if (page.pageMarker) {
      if (page.pageMarker.page === 1) start("marker");
      else keep();
      continue;
    }

    // c) TITLE PATTERNS.
    if (page.docType) {
      if (page.docType === last.docType && page.continuation) keep();
      else start("title");
      continue;
    }

    // No signal at all: the page belongs to the form that started before it.
    keep();
  }

  return groups.map(({ code: _code, ...group }) => group);
}

/** Documents that ended shorter than their printed "of M". Logged, never shown as an error. */
export function shortDocuments<T extends PageSignals>(
  groups: Array<DocGroup<T>>,
): Array<{ index: number; expected: number; actual: number }> {
  return groups
    .map((group, index) => ({
      index,
      expected: group.expectedPages ?? 0,
      actual: group.pages.length,
    }))
    .filter((entry) => entry.expected > 0 && entry.actual < entry.expected);
}
