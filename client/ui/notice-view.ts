// A screen that says one thing and offers a way on.
//
// Four of these exist — sign in, no connection, no barcode reader, shelf
// finished — and they are the moments where the app has to explain itself
// rather than be tapped. They share a shape so that an auditor who has read
// one knows where the way out is on the next.

import { el, replace } from './dom.js';
import type { Child } from './dom.js';

export function renderNotice(
  host: HTMLElement,
  title: string,
  lines: readonly Child[],
  actions: readonly Child[],
): void {
  // Empty entries are dropped rather than rendered blank, so a caller can
  // write a line or a button as a conditional without an empty paragraph or a
  // gap in the button grid showing up when the condition is false.
  const said = lines.filter((line) => line !== '');
  replace(
    host,
    el('header', {}, el('h1', {}, title)),
    ...said.map((line) => (typeof line === 'string' ? el('p', {}, line) : line)),
    el('nav', {}, ...actions.filter((action) => action !== '')),
  );
}
