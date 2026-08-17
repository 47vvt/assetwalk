// The whole UI toolkit. There is no framework here and there does not need to
// be: the app is four screens of lists and buttons, and a hundred packages of
// reconciliation machinery would be more code to audit than the audit tool.

type Child = Node | string;

export function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElement {
  const node = window.document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

export function button(label: Child, onClick: () => void, className = ''): HTMLElement {
  const node = el('button', { class: className }, label);
  node.addEventListener('click', onClick);
  return node;
}

// The last four digits, which is what people actually read off a handwritten
// note — the prefix is the same on every device in the building and the eye
// skips it.
export function lastFour(tag: string): string {
  return tag.slice(-4);
}

export function replace(host: HTMLElement, ...children: Child[]): void {
  host.replaceChildren(...children);
}
