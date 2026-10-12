import { t } from "./i18n";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

export function button(labelKey: string, onClick: () => void, className = "button"): HTMLButtonElement {
  const b = el("button", { type: "button", className }, [t(labelKey)]);
  b.addEventListener("click", onClick);
  return b;
}
