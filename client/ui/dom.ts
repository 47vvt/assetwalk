// The whole UI toolkit. There is no framework here and there does not need to
// be: the app is four screens of lists and buttons, and a hundred packages of
// reconciliation machinery would be more code to audit than the audit tool.

export type Child = Node | string;

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

// Typed separately from `el` because the one place that needs a text field
// needs `.value`, and reading it off a generic HTMLElement would mean an `as`.
export function input(attrs: Record<string, string>): HTMLInputElement {
  const node = window.document.createElement('input');
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

export function button(label: Child, onClick: () => void, className = ''): HTMLElement {
  const node = el('button', { class: className }, label);
  node.addEventListener('click', onClick);
  return node;
}

// How many trailing characters carry the emphasis. Four is what people
// actually read off a handwritten note: the prefix is identical on every
// device in the building, so the eye skips it and only the tail distinguishes
// one laptop from the next.
const KEY_DIGITS = 4;

// The whole tag, always, at one size — an auditor comparing a screen against a
// sticky note is matching a string, and a string that changes size mid-way is
// harder to match than one that does not. Only the ink differs: the prefix is
// faint because it is identical on every device in the building, so the eye
// lands on the tail without the rest being hidden.
export function tagLabel(tag: string): HTMLElement {
  return el(
    'span',
    { class: 'tag' },
    el('span', { class: 'prefix' }, tag.slice(0, -KEY_DIGITS)),
    el('span', { class: 'key' }, tag.slice(-KEY_DIGITS)),
  );
}

export function replace(host: HTMLElement, ...children: Child[]): void {
  host.replaceChildren(...children);
}
