import { defaultMessageLocale, projectMessage } from "./messages";
export function qiyApiError(payload: unknown, statusCode: number, locale = typeof document === "undefined" ? defaultMessageLocale : document.documentElement.lang) {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const errorKey = typeof body.errorKey === "string" ? body.errorKey : undefined;
  const fallback = typeof body.error === "string" ? body.error : "API error " + statusCode;
  const message = errorKey ? projectMessage(locale, errorKey) ?? fallback : fallback;
  return Object.assign(new Error(message), { statusCode, ...(errorKey ? { errorKey } : {}) });
}
