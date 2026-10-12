import { DEALER_FIELDS, EMPTY_COVER, drawCover, type CoverData, type CoverEntry } from "./cover";
import { DOC_TYPES, NOT_SENT_BY_DEFAULT, docTypeKey, type DocType } from "./dealer/docTypes";
import { groupPages, type PageSignals } from "./dealer/documentGrouping";
import { loadRooftops, type Rooftop } from "./dealerInfo";
import { button, el } from "./dom";
import { t } from "./i18n";
import { buildPdf } from "./pdf";
import { docs, state, subscribe, textOf, type Page } from "./state";
import { findVin } from "./textLayer";

/** A document found in the pages, named by the key of its first page. */
type PackageDoc = { key: string; type: DocType; pages: Page[] };

type Prefs = { include: Partial<Record<DocType, boolean>> };

const typeOverride = new Map<string, DocType>();
const includeOverride = new Map<string, boolean>();
/** Keys of documents in the order the dealer arranged them; others follow the usual stack. */
let manualOrder: string[] = [];
let prefs: Prefs = { include: {} };
let cover: CoverData = { ...EMPTY_COVER };
let withCover = true;
let rooftops: Rooftop[] = [];
let vinGuessed = false;

async function loadPrefs() {
  const stored = await chrome.storage.local.get(["packagePrefs", "coverDealer", "withCover"]);
  prefs = (stored.packagePrefs as Prefs | undefined) ?? { include: {} };
  const dealer = stored.coverDealer as Partial<CoverData> | undefined;
  if (dealer) for (const field of DEALER_FIELDS) cover[field] = dealer[field] ?? "";
  if (typeof stored.withCover === "boolean") withCover = stored.withCover;
}

function saveDealer() {
  const dealer: Partial<CoverData> = {};
  for (const field of DEALER_FIELDS) dealer[field] = cover[field];
  void chrome.storage.local.set({ coverDealer: dealer, withCover });
}

function included(doc: PackageDoc): boolean {
  return includeOverride.get(doc.key) ?? prefs.include[doc.type] ?? !NOT_SENT_BY_DEFAULT.has(doc.type);
}

/** Splits the current pages into documents with the same rules DealerInk uses. */
async function documents(): Promise<PackageDoc[]> {
  const signals: (PageSignals & { page: Page })[] = [];
  for (const [index, page] of state.pages.entries()) {
    const text = await textOf(page);
    signals.push({ ...text.signals, index, page });
  }
  const groups = groupPages(signals).map((group) => {
    const key = group.pages[0]!.page.key;
    return {
      key,
      type: typeOverride.get(key) ?? (group.docType as DocType),
      pages: group.pages.map((s) => s.page),
    };
  });
  const rank = (doc: PackageDoc) => {
    const manual = manualOrder.indexOf(doc.key);
    return manual >= 0 ? manual : manualOrder.length + DOC_TYPES.indexOf(doc.type);
  };
  return groups
    .map((doc, position) => ({ doc, position }))
    .sort((a, b) => rank(a.doc) - rank(b.doc) || a.position - b.position)
    .map(({ doc }) => doc);
}

export type PackageView = { node: HTMLElement; refresh: () => void };

export function createPackageView(onError: (message: string | null) => void, setStatus: (text: string) => void): PackageView {
  const list = el("ol", { className: "package-list" });
  const side = el("aside", { className: "package-side" });
  const node = el("div", { className: "package" }, [
    el("section", { className: "package-main" }, [
      el("h2", { className: "title" }, [t("packageTitle")]),
      el("p", { className: "muted small" }, [t("packageHint")]),
      list,
    ]),
    side,
  ]);
  let current: PackageDoc[] = [];
  let drawing = 0;

  const coverToggle = el("input", { type: "checkbox", checked: withCover, id: "cover-toggle" });
  const downloadButton = button("downloadPackage", () => void download(), "button primary");
  const fields = el("div", { className: "stack tight" });
  const rooftopSelect = el("select", { className: "input", id: "cover-rooftop" });

  function field(key: keyof CoverData, labelKey: string, multiline = false) {
    const id = `cover-${key}`;
    const input = multiline
      ? el("textarea", { className: "input", id, rows: 3, value: cover[key] })
      : el("input", { className: "input", id, value: cover[key] });
    input.addEventListener("input", () => {
      cover[key] = input.value;
      if ((DEALER_FIELDS as readonly string[]).includes(key)) saveDealer();
    });
    return [el("label", { className: "label", htmlFor: id }, [t(labelKey)]), input];
  }

  function drawSide() {
    coverToggle.checked = withCover;
    fields.hidden = !withCover;
    fields.replaceChildren(
      ...(rooftops.length > 1 ? [el("label", { className: "label", htmlFor: "cover-rooftop" }, [t("coverRooftop")]), rooftopSelect] : []),
      ...field("dealerName", "coverDealerName"),
      ...field("dealerAddress", "coverDealerAddress", true),
      ...field("dealerPhone", "coverDealerPhone"),
      ...field("buyer", "coverBuyer"),
      ...field("coBuyer", "coverCoBuyer"),
      ...field("vehicle", "coverVehicle"),
      ...field("vin", "coverVin"),
      ...field("stockNumber", "coverStock"),
      ...field("dealNumber", "coverDeal"),
      ...field("lender", "coverLender"),
      ...field("contractDate", "coverDate"),
      ...field("notes", "coverNotes", true),
    );
  }

  coverToggle.addEventListener("change", () => {
    withCover = coverToggle.checked;
    saveDealer();
    drawSide();
  });
  rooftopSelect.addEventListener("change", () => {
    const rooftop = rooftops.find((r) => r.id === rooftopSelect.value);
    if (!rooftop) return;
    cover.dealerName = rooftop.name;
    cover.dealerAddress = rooftop.address;
    cover.dealerPhone = rooftop.phone;
    saveDealer();
    drawSide();
  });

  side.append(
    el("label", { className: "toggle" }, [coverToggle, " " + t("coverInclude")]),
    fields,
    downloadButton,
  );

  async function draw() {
    const run = ++drawing;
    const docsNow = await documents();
    if (run !== drawing) return;
    current = docsNow;
    if (!vinGuessed && !cover.vin) {
      vinGuessed = true;
      const texts = await Promise.all(state.pages.map((p) => textOf(p).then((x) => x.fullText)));
      cover.vin = findVin(texts) ?? "";
      drawSide();
    }
    list.replaceChildren(
      ...current.map((doc, i) => {
        const include = el("input", { type: "checkbox", checked: included(doc) });
        include.setAttribute("aria-label", t("includeInPackage"));
        include.addEventListener("change", () => {
          includeOverride.set(doc.key, include.checked);
          // Learned per type: next time this kind of document starts the same way.
          prefs.include[doc.type] = include.checked;
          void chrome.storage.local.set({ packagePrefs: prefs });
          void draw();
        });
        const type = el("select", { className: "input compact" });
        type.setAttribute("aria-label", t("documentType"));
        for (const value of DOC_TYPES) type.append(el("option", { value, textContent: t(docTypeKey(value)) }));
        type.value = doc.type;
        type.addEventListener("change", () => {
          typeOverride.set(doc.key, type.value as DocType);
          void draw();
        });
        const move = (delta: number) => {
          const keys = current.map((d) => d.key);
          const [moved] = keys.splice(i, 1);
          keys.splice(Math.max(0, Math.min(keys.length, i + delta)), 0, moved!);
          manualOrder = keys;
          void draw();
        };
        const up = button("moveUp", () => move(-1), "button icon");
        const down = button("moveDown", () => move(1), "button icon");
        up.disabled = i === 0;
        down.disabled = i === current.length - 1;
        const first = doc.pages[0]!;
        const positions = doc.pages.map((p) => state.pages.indexOf(p) + 1);
        return el("li", { className: `package-row${included(doc) ? "" : " excluded"}` }, [
          include,
          el("div", { className: "stack tight grow" }, [
            type,
            el("span", { className: "muted small" }, [
              t("documentPages", [String(doc.pages.length), positions.length > 1 ? `${positions[0]}-${positions.at(-1)}` : String(positions[0]), docs.get(first.docId)?.name ?? ""]),
            ]),
          ]),
          up,
          down,
        ]);
      }),
    );
    const any = current.some(included);
    downloadButton.disabled = state.busy || !any;
  }

  async function download() {
    const chosen = current.filter(included);
    if (chosen.length === 0 || state.busy) return;
    state.busy = true;
    downloadButton.disabled = true;
    onError(null);
    setStatus(t("building"));
    try {
      const pages = chosen.flatMap((doc) => doc.pages);
      const entries: CoverEntry[] = [];
      let next = withCover ? 2 : 1;
      for (const doc of chosen) {
        entries.push({ name: englishName(doc.type), firstPage: next, lastPage: next + doc.pages.length - 1 });
        next += doc.pages.length;
      }
      const sources = new Map<string, Uint8Array>();
      for (const p of pages) sources.set(p.docId, docs.get(p.docId)!.bytes);
      const bytes = await buildPdf(
        sources,
        pages.map((p) => ({ bytesKey: p.docId, index: p.index, extraRotation: p.turn, edits: p.edits })),
        withCover ? (output) => drawCover(output, cover, entries) : undefined,
      );
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const who = (cover.buyer || cover.vin || "funding").trim();
      const filename = `${who}-funding-package.pdf`.replace(/[\\/:*?"<>|]+/g, "_");
      await chrome.downloads.download({ url, filename, saveAs: true });
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(t("downloaded"));
    } catch (error) {
      if (!(error instanceof Error && /cancel/i.test(error.message))) onError(t("errorUnknown"));
      setStatus("");
    } finally {
      state.busy = false;
      void draw();
    }
  }

  drawSide();
  subscribe(() => {
    if (node.isConnected) void draw();
  });
  void loadPrefs().then(async () => {
    rooftops = await loadRooftops();
    rooftopSelect.replaceChildren(
      el("option", { value: "", textContent: t("coverRooftopPick") }),
      ...rooftops.map((r) => el("option", { value: r.id, textContent: r.name })),
    );
    if (!cover.dealerName && rooftops[0]) {
      cover.dealerName = rooftops[0].name;
      cover.dealerAddress = rooftops[0].address;
      cover.dealerPhone = rooftops[0].phone;
      saveDealer();
    }
    drawSide();
  });

  return { node, refresh: () => void draw() };
}

/** Names on the cover are in English: it goes to a US lender. */
const ENGLISH: Record<DocType, string> = {
  retail_installment_contract: "Retail Installment Contract",
  credit_application: "Credit Application",
  buyers_order: "Buyer's Order",
  itemization_of_sale: "Itemization of Amount Financed",
  risk_based_pricing_notice: "Risk-Based Pricing Notice",
  odometer_disclosure: "Odometer Disclosure",
  title_application: "Application for Title",
  state_title_application: "Application for Certificate of Title",
  reassignment_of_title: "Reassignment of Title",
  power_of_attorney: "Power of Attorney",
  gap_disclosure: "GAP Disclosure",
  gap_addendum: "GAP Addendum",
  vehicle_service_contract: "Vehicle Service Contract",
  theft_recovery_agreement: "Vehicle Location and Theft Recovery Agreement",
  arbitration_agreement: "Arbitration Agreement",
  buyers_guide: "Buyers Guide",
  privacy_notice: "Privacy Notice",
  e_sign_consent: "E-Sign Consent",
  we_owe: "We Owe / Due Bill",
  temporary_permit: "Temporary Permit",
  satellite_radio_trial: "Radio Trial Subscription",
  scanned_document: "Scanned Document",
  other: "Other Document",
};
function englishName(type: DocType): string {
  return ENGLISH[type];
}
