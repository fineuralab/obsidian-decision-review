import { Notice, setIcon } from 'obsidian';
import { getLocale, t } from './i18n';
import { errorText } from './store';
export function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text?: string): HTMLElementTagNameMap[K] { const node = parent.ownerDocument.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; parent.append(node); return node; }
export function button(parent: HTMLElement, label: string, callback: () => void | Promise<unknown>, className = '', icon?: string): HTMLButtonElement {
  const node = el(parent, 'button', `dr-button ${className}`); node.type = 'button';
  if (icon) { const span = el(node, 'span', 'dr-icon'); setIcon(span, icon); span.setAttribute('aria-hidden', 'true'); }
  el(node, 'span', '', label); node.addEventListener('click', () => { void Promise.resolve().then(callback).catch(error => new Notice(errorText(error), 10000)); }); return node;
}
let fieldID = 0;
export function field(parent: HTMLElement, label: string, value = '', options: { multiline?: boolean; type?: string; required?: boolean; hint?: string; max?: number } = {}): HTMLInputElement | HTMLTextAreaElement {
  const wrapper = el(parent, 'label', 'dr-field'); const caption = el(wrapper, 'span', 'dr-field-label', label + (options.required ? ' *' : '')); caption.id = `decision-review-field-${++fieldID}`;
  const node = options.multiline ? el(wrapper, 'textarea') : el(wrapper, 'input'); node.value = value; node.required = !!options.required; node.maxLength = options.max ?? (options.multiline ? 10000 : 160);
  if (node.tagName === 'INPUT') (node as HTMLInputElement).type = options.type || 'text'; else (node as HTMLTextAreaElement).rows = 3;
  node.setAttribute('aria-labelledby', caption.id);
  if (options.hint) { const hint = el(wrapper, 'small', 'dr-muted', options.hint); hint.id = `${caption.id}-hint`; node.setAttribute('aria-describedby', hint.id); } return node;
}
export function select(parent: HTMLElement, label: string, options: Record<string, string>, value: string): HTMLSelectElement {
  const wrapper = el(parent, 'label', 'dr-field'); const caption = el(wrapper, 'span', 'dr-field-label', label); caption.id = `decision-review-field-${++fieldID}`; const node = el(wrapper, 'select'); node.setAttribute('aria-labelledby', caption.id);
  for (const [key, text] of Object.entries(options)) { const option = el(node, 'option', '', text); option.value = key; } node.value = value; return node;
}
export function dateLabel(value: string, year = true): string { const date = new Date(value.length === 10 ? `${value}T12:00:00` : value); return new Intl.DateTimeFormat(getLocale(), { year: year ? 'numeric' : undefined, month: 'short', day: 'numeric' }).format(date); }
export function optional(zh: string, en: string): string { return t('{0}（选填）', '{0} (optional)', t(zh, en)); }
