import { expect, test } from "bun:test";
import { downloadFile } from "../app/hooks/download-file";

test("uses an authorized signed S3 URL without proxying object bytes", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const links: Array<{ href: string; target: string; rel: string; click: () => void }> = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => "bearer" } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => { const link = { href: "", target: "", rel: "", click: () => {} }; links.push(link); return link; } } });
  try {
    const calls: Array<{ url: string; headers: HeadersInit | undefined }> = [];
    const fetcher = (async (url: RequestInfo | URL, options?: RequestInit) => { calls.push({ url: String(url), headers: options?.headers }); return Response.json({ url: "https://storage.example.com/signed" }); }) as typeof fetch;
    await downloadFile("orders/invoice.pdf", fetcher);
    expect(calls).toEqual([{ url: "/api/v1/files/signed?key=orders%2Finvoice.pdf", headers: { Authorization: "Bearer bearer" } }]);
    expect(links[0]).toMatchObject({ href: "https://storage.example.com/signed", target: "_blank", rel: "noopener noreferrer" });
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});
