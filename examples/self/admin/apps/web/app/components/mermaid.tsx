import { Alert, Spin } from "antd";
import { useEffect, useRef, useState } from "react";

/**
 * Renders one Mermaid diagram. The server render keeps the diagram source in a
 * stable container (so the docs SSR test and bundle checks can see the generated
 * source); the browser dynamically imports mermaid and injects the SVG.
 */
export function MermaidDiagram({ id, source, ariaLabel, errorText }: { id: string; source: string; ariaLabel: string; errorText: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
        const rendered = await mermaid.render("qiy-mermaid-" + id, source);
        if (!cancelled && container.current) container.current.innerHTML = rendered.svg;
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, source]);
  return <div className="qiy-mermaid" data-diagram={source} aria-label={ariaLabel}>
    <div ref={container} />
    {rendering ? <Spin size="small" /> : null}
    {error ? <Alert type="warning" showIcon message={errorText} description={error} /> : null}
  </div>;
}
