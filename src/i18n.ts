/**
 * Chrome picks the language from the browser (en, es, pt_BR in
 * public/_locales). A missing key shows the key itself, which the locale check
 * in scripts/ catches before release.
 */
export function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/** Fills every element marked data-i18n (text) or data-i18n-title (tooltip). */
export function translatePage(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const label = t(el.dataset.i18nTitle!);
    el.title = label;
    el.setAttribute("aria-label", label);
  });
  root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder!);
  });
  document.documentElement.lang = chrome.i18n.getUILanguage();
}
