import { Alert, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import { useQiyUiOptional } from "../ui";

/** Maximum time the deferred Mermaid render may take before the source fallback is shown. */
export const QIY_MERMAID_TIMEOUT_MS = 10_000;

/**
 * Renders one Mermaid diagram. The server render keeps the diagram source in a
 * stable container (so docs SSR tests and bundle checks can see it); the browser
 * defers the heavy dynamic import to a later task, renders asynchronously, and
 * falls back to the raw source after a timeout or on any error instead of
 * leaving a blank/frozen panel. The diagram theme follows the app color mode
 * (亮色/暗色/跟随系统) and re-renders when it changes.
 */
export function MermaidDiagram({ id, source, ariaLabel, errorText, timeoutText }: { id: string; source: string; ariaLabel: string; errorText: string; timeoutText?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const renderSeq = useRef(0);
  const { resolvedColorMode } = useQiyUiOptional() ?? { resolvedColorMode: "light" as const };
  const [error, setError] = useState<string | undefined>();
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let delay: ReturnType<typeof setTimeout> | undefined;
    let guard: ReturnType<typeof setTimeout> | undefined;
    setError(undefined);
    setRendering(true);
    const start = () => {
      guard = setTimeout(() => {
        if (cancelled) return;
        setError(timeoutText ?? "Mermaid rendering timed out");
        setRendering(false);
      }, QIY_MERMAID_TIMEOUT_MS);
      void (async () => {
        try {
          const mermaid = (await import("mermaid")).default;
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: resolvedColorMode === "dark" ? "dark" : "default" });
          // A fresh id per render avoids duplicate-definition warnings when the
          // color mode flips and the diagram is rendered again.
          renderSeq.current += 1;
          const rendered = await mermaid.render("qiy-mermaid-" + id + "-" + renderSeq.current, source);
          if (!cancelled && container.current) container.current.innerHTML = rendered.svg;
        } catch (cause) {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          if (guard) clearTimeout(guard);
          if (!cancelled) setRendering(false);
        }
      })();
    };
    // Defer the import/render so the tab shell paints first; unmount/remount
    // (tab switches, HMR, StrictMode) cancels the pending render.
    delay = setTimeout(start, 0);
    return () => {
      cancelled = true;
      if (delay) clearTimeout(delay);
      if (guard) clearTimeout(guard);
    };
  }, [id, source, timeoutText, resolvedColorMode]);
  return <div className="qiy-mermaid" data-diagram={source} aria-label={ariaLabel}>
    <div ref={container} />
    {rendering ? <Spin size="small" /> : null}
    {error ? <>
      <Alert type="warning" showIcon message={errorText} description={error} />
      <pre className="qiy-mermaid-fallback" data-mermaid-fallback={source}>{source}</pre>
    </> : null}
  </div>;
}
