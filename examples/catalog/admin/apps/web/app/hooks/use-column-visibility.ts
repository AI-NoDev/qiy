import { useState } from "react";
import type { ResourceDefinition } from "../resources";

interface ColumnPreferences {
  fields: string[];
  selected: string[];
}

export function loadColumns(resource?: ResourceDefinition): string[] {
  if (!resource) return [];
  const defaults = resource.fields.filter((field) => field.listVisible).map((field) => field.name);
  if (typeof window === "undefined") return defaults;
  try {
    const saved = JSON.parse(window.localStorage.getItem(`qiy.columns.${resource.name}`) ?? "null") as ColumnPreferences | null;
    if (!saved || !Array.isArray(saved.fields) || !Array.isArray(saved.selected)) return defaults;
    const allowed = new Set(resource.fields.map((field) => field.name));
    const previous = new Set(saved.fields);
    return [...new Set([...saved.selected.filter((name) => allowed.has(name)), ...defaults.filter((name) => !previous.has(name))])];
  } catch { return defaults; }
}

export function useColumnVisibility(resource?: ResourceDefinition) {
  const [state, setState] = useState(() => ({ resource: resource?.name, keys: loadColumns(resource) }));
  const visibleKeys = state.resource === resource?.name ? state.keys : loadColumns(resource);
  const setVisibleKeys = (update: (keys: string[]) => string[]) => {
    if (!resource) return;
    const next = update(visibleKeys);
    window.localStorage.setItem(`qiy.columns.${resource.name}`, JSON.stringify({ fields: resource.fields.map((field) => field.name), selected: next } satisfies ColumnPreferences));
    setState({ resource: resource.name, keys: next });
  };
  return { visibleKeys, setVisibleKeys };
}
