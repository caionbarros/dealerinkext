/**
 * Notices PDFs and offers the editor. Chrome's own PDF viewer cannot be drawn
 * on by an extension, so the offer is the toolbar badge (open tab) and a
 * notification (finished download); the editing itself happens in editor.html.
 *
 * The service worker can be stopped at any time, so what it knows lives in
 * chrome.storage.session.
 */
import { t } from "./i18n";
import { editorUrl, isPdfUrl, type PdfTabs } from "./shared";

const MENU_ID = "dealerink-edit-link";

async function pdfTabs(): Promise<PdfTabs> {
  const { pdfTabs } = await chrome.storage.session.get("pdfTabs");
  return (pdfTabs as PdfTabs | undefined) ?? {};
}

async function setPdfTab(tabId: number, url: string | null): Promise<void> {
  const tabs = await pdfTabs();
  if (url) tabs[tabId] = url;
  else delete tabs[tabId];
  await chrome.storage.session.set({ pdfTabs: tabs });
  await chrome.action.setBadgeText({ tabId, text: url ? "PDF" : "" });
  if (url) await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
  await chrome.action.setTitle({ tabId, title: url ? t("badgeTitle") : t("extName") });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: t("menuEditLink"),
    contexts: ["link"],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID && info.linkUrl) {
    void chrome.tabs.create({ url: editorUrl({ src: info.linkUrl }) });
  }
});

// A PDF served without ".pdf" in the address is recognized by its type.
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return undefined;
    const type = details.responseHeaders?.find((h) => h.name.toLowerCase() === "content-type");
    if (type?.value?.toLowerCase().includes("application/pdf")) {
      void setPdfTab(details.tabId, details.url);
    }
    return undefined;
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
  ["responseHeaders"],
);

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  if (isPdfUrl(change.url)) {
    void setPdfTab(tabId, change.url);
    return;
  }
  // The tab moved on. Keep the mark only while the address is the PDF's.
  void pdfTabs().then((tabs) => {
    if (tabs[tabId] && tabs[tabId] !== change.url) void setPdfTab(tabId, null);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void pdfTabs().then((tabs) => {
    if (tabs[tabId]) {
      delete tabs[tabId];
      void chrome.storage.session.set({ pdfTabs: tabs });
    }
  });
});

// Finished PDF downloads get an offer, unless the person turned it off or the
// file is one this extension just saved.
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current !== "complete") return;
  void (async () => {
    const { notifyDownloads } = await chrome.storage.local.get("notifyDownloads");
    if (notifyDownloads === false) return;
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (!item || item.byExtensionId === chrome.runtime.id) return;
    const isPdf = item.mime === "application/pdf" || /\.pdf$/i.test(item.filename);
    if (!isPdf) return;
    const name = item.filename.split(/[\\/]/).pop() ?? "PDF";
    chrome.notifications.create(`download-${item.id}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: t("notifyTitle"),
      message: t("notifyBody", name),
      buttons: [{ title: t("notifyEdit") }],
      priority: 0,
    });
  })();
});

function openDownload(notificationId: string): void {
  const id = Number(notificationId.replace("download-", ""));
  if (!Number.isFinite(id)) return;
  void chrome.tabs.create({ url: editorUrl({ download: String(id) }) });
  chrome.notifications.clear(notificationId);
}

chrome.notifications.onButtonClicked.addListener((notificationId) => openDownload(notificationId));
chrome.notifications.onClicked.addListener((notificationId) => openDownload(notificationId));
