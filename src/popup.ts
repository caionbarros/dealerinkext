import { mountAuth } from "./authView";
import { signOut } from "./auth";
import { t, translatePage } from "./i18n";
import { editorUrl, type PdfTabs } from "./shared";

translatePage();

const root = document.getElementById("root")!;

async function currentPdf(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;
  const { pdfTabs } = await chrome.storage.session.get("pdfTabs");
  return (pdfTabs as PdfTabs | undefined)?.[tab.id] ?? null;
}

void mountAuth(root, async (access) => {
  const pdf = await currentPdf();
  root.replaceChildren();

  const stack = document.createElement("div");
  stack.className = "stack";

  if (pdf) {
    const edit = document.createElement("button");
    edit.className = "button primary";
    edit.textContent = t("editThisPdf");
    edit.addEventListener("click", () => {
      void chrome.tabs.create({ url: editorUrl({ src: pdf }) });
      window.close();
    });
    stack.append(edit);
  } else {
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = t("noPdfHere");
    stack.append(hint);
  }

  const open = document.createElement("button");
  open.className = pdf ? "button" : "button primary";
  open.textContent = t("openEditor");
  open.addEventListener("click", () => {
    void chrome.tabs.create({ url: editorUrl() });
    window.close();
  });
  stack.append(open);

  const { notifyDownloads } = await chrome.storage.local.get("notifyDownloads");
  const toggle = document.createElement("label");
  toggle.className = "toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = notifyDownloads !== false;
  checkbox.addEventListener("change", () => {
    void chrome.storage.local.set({ notifyDownloads: checkbox.checked });
  });
  toggle.append(checkbox, document.createTextNode(" " + t("notifyToggle")));
  stack.append(toggle);

  const account = document.createElement("p");
  account.className = "muted small";
  const out = document.createElement("button");
  out.className = "button text";
  out.textContent = t("signOut");
  out.addEventListener("click", async () => {
    await signOut();
    window.location.reload();
  });
  account.append(t("signedInAs", access.email) + " ", out);
  stack.append(account);

  root.append(stack);
});
