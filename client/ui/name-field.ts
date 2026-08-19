// Naming something that does not exist yet — an audit, or a shelf the site has
// never seen. Both are a typed name checked as it is typed, next to a button
// that stays disabled until the name is one the domain will accept.
//
// The check is the same smart constructor the rest of the app uses, so a name
// the field accepts is a name the reducer and the backend accept. Doing it as
// the auditor types beats rejecting on submit: the button not lighting up
// explains itself, and an error message after the fact does not.

import { button, input } from './dom.js';

export interface NameField {
  readonly field: HTMLInputElement;
  readonly commit: HTMLElement;
}

export function nameField(spec: {
  readonly label: string;
  readonly placeholder: string;
  readonly action: string;
  readonly accepts: (raw: string) => boolean;
  readonly submit: (raw: string) => void;
}): NameField {
  const field = input({
    class: 'nameinput',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: spec.placeholder,
    'aria-label': spec.label,
  });

  const typed = (): string => field.value.trim();
  const submit = (): void => {
    if (spec.accepts(typed())) spec.submit(typed());
  };

  const commit = button(spec.action, submit, 'finish wide');
  commit.setAttribute('disabled', '');

  field.addEventListener('input', () => commit.toggleAttribute('disabled', !spec.accepts(typed())));
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  return { field, commit };
}

