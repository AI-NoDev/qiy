export const defaultMessageLocale = "zh-CN";
export const projectMessages: Record<string, Record<string, string>> = {};
export function projectMessage(locale: string, key: string): string | undefined { const entries = Object.hasOwn(projectMessages, locale) ? projectMessages[locale] : undefined; if (entries && Object.hasOwn(entries, key)) return entries[key]; const fallback = projectMessages[defaultMessageLocale]; return fallback && Object.hasOwn(fallback, key) ? fallback[key] : undefined; }
