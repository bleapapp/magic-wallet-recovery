/**
 * A tiny DOM builder. Strings always become text nodes and links are limited to https, so data read
 * from the chain (token symbols, for example) can never be interpreted as markup. The page never
 * uses innerHTML.
 */
export type Child = Node | string | number | bigint | false | null | undefined | Child[];

export interface Props {
  class?: string;
  id?: string;
  type?: string;
  name?: string;
  value?: string;
  placeholder?: string;
  title?: string;
  role?: string;
  for?: string;
  href?: string;
  min?: string;
  autocomplete?: string;
  inputmode?: string;
  'aria-live'?: string;
  'aria-label'?: string;
  checked?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  selected?: boolean;
  spellcheck?: boolean;
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: Event) => void;
  onChange?: (event: Event) => void;
  onSubmit?: (event: SubmitEvent) => void;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props) as [keyof Props, Props[keyof Props]][]) {
    // `spellcheck` is the one attribute whose `false` value must be written out.
    if (key === 'spellcheck') {
      if (value !== undefined) element.setAttribute('spellcheck', value ? 'true' : 'false');
      continue;
    }
    if (value === undefined || value === false) continue;
    switch (key) {
      case 'onClick':
        element.addEventListener('click', value as (event: Event) => void);
        break;
      case 'onInput':
        element.addEventListener('input', value as (event: Event) => void);
        break;
      case 'onChange':
        element.addEventListener('change', value as (event: Event) => void);
        break;
      case 'onSubmit':
        element.addEventListener('submit', value as (event: Event) => void);
        break;
      case 'class':
        element.className = String(value);
        break;
      case 'value':
        (element as HTMLInputElement).value = String(value);
        break;
      case 'selected':
        (element as HTMLOptionElement).selected = Boolean(value);
        break;
      case 'checked':
        (element as HTMLInputElement).checked = Boolean(value);
        break;
      case 'href': {
        const url = String(value);
        if (url.startsWith('https://')) {
          element.setAttribute('href', url);
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        }
        break;
      }
      default:
        element.setAttribute(key, value === true ? '' : String(value));
    }
  }
  appendChildren(element, children);
  return element;
}

function appendChildren(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/** Replaces the content of `root`. */
export function mount(root: HTMLElement, ...children: Child[]): void {
  root.replaceChildren();
  appendChildren(root, children);
}

export function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}
