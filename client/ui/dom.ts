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

// How many trailing characters carry the emphasis. Four is what people
// actually read off a handwritten note: the prefix is identical on every
// device in the building, so the eye skips it and only the tail distinguishes
// one laptop from the next.
const KEY_DIGITS = 4;

// The whole tag, always — an auditor comparing a screen against a sticky note
// needs to see the same string that is written on it. The prefix is printed
// small and faint rather than hidden, so the tail is what the eye lands on
// without the rest becoming a thing they have to take on trust.
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
