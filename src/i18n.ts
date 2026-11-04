export type Locale = 'zh-CN' | 'en';
export type LanguagePreference = 'auto' | Locale;
let locale: Locale = 'zh-CN';
export function getLocale(): Locale { return locale; }
export function setLocale(value: Locale): void { locale = value; }
export function normalizePreference(value: unknown): LanguagePreference { return value === 'en' || value === 'zh-CN' ? value : 'auto'; }
export function resolveLocale(preference: LanguagePreference, hostLanguage: string): Locale {
  return preference !== 'auto' ? preference : /^zh(?:[-_]|$)/i.test(hostLanguage) ? 'zh-CN' : 'en';
}
export function translator(language: Locale) {
  return (zh: string, en: string, ...values: unknown[]): string => (language === 'en' ? en : zh).replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : match);
}
export function t(zh: string, en: string, ...values: unknown[]): string { return translator(locale)(zh, en, ...values); }
