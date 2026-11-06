import { useDataProvider, useMany } from "@refinedev/core";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ResourceField } from "../resources";

/**
 * Batched foreign-key lookups.
 *
 * A list page with FK columns used to resolve every cell through `useOne`, i.e.
 * one `GET /api/v1/<resource>/<id>` per cell (a page of stock movements with
 * three FK columns fired dozens of detail requests). The generated list
 * endpoints accept an id-set filter
 * (`filters=[{"field":"id","operator":"in","value":"a,b"}]`), so a page groups
 * its FK values per target resource and resolves each group with one `useMany`
 * call (`getMany` in `app/data-provider.ts`).
 *
 * `RelationLink` still keeps its `useOne` fallback — disabled while a batched
 * record is available — so show pages, drawer bodies, related-record tables,
 * selects and host integrations whose data provider has no `getMany` keep the
 * previous single-record behaviour.
 */

/** Maximum ids requested for one target resource; keeps the filter query bounded. */
export const maxRelationBatchIds = 200;

export interface RelationBatchPlanEntry {
  /** Target resource name (the FK's `relation.resource`, i.e. the table name). */
  resource: string;
  /** Deduped, sorted ids to load for that resource. */
  ids: string[];
}

export type RelationBatchRecords = ReadonlyMap<string, ReadonlyMap<string, Record<string, unknown>>>;

/**
 * Builds the batch plan for one page: the FK values of `fields` are grouped by
 * target resource, deduped, blank values are skipped and each group is capped.
 * The result is sorted by resource name and each id list is sorted, so the same
 * rows always produce the same plan (and therefore the same React Query keys).
 *
 * `fields` is caller-controlled: list pages pass `listVisible` fields, the show
 * page passes its `showVisible` fields. Fields without a relation are ignored.
 */
export function buildRelationBatchPlan(fields: ReadonlyArray<ResourceField>, rows: ReadonlyArray<Record<string, unknown>> | undefined): RelationBatchPlanEntry[] {
  const grouped = new Map<string, Set<string>>();
  for (const field of fields) {
    const target = field.relation?.resource;
    if (!target) continue;
    for (const row of rows ?? []) {
      const raw = row[field.name];
      if (raw === null || raw === undefined || raw === "") continue;
      const id = String(raw);
      if (!id) continue;
      const ids = grouped.get(target) ?? new Set<string>();
      ids.add(id);
      grouped.set(target, ids);
    }
  }
  return [...grouped.entries()]
    .map(([resource, ids]) => ({ resource, ids: [...ids].sort().slice(0, maxRelationBatchIds) }))
    .sort((left, right) => (left.resource < right.resource ? -1 : left.resource > right.resource ? 1 : 0));
}

export interface RelationBatchState {
  /** Loaded FK records: resource -> id -> record. */
  records: RelationBatchRecords;
  /** Resources whose batch query is still loading; their cells must not fall back to `useOne`. */
  pending: ReadonlySet<string>;
}

const emptyRelationBatchState: RelationBatchState = { records: new Map(), pending: new Set() };
const RelationBatchContext = createContext<RelationBatchState>(emptyRelationBatchState);

/** One `useMany` per target resource. Rendered once per plan entry, so hook order never changes. */
function RelationBatchLayer({ entry, children }: { entry: RelationBatchPlanEntry; children: ReactNode }) {
  const parent = useContext(RelationBatchContext);
  const { result, query } = useMany<Record<string, unknown>>({
    resource: entry.resource,
    ids: entry.ids,
    queryOptions: {
      staleTime: 60_000,
      gcTime: 300_000,
      retry: false,
      // The list page owns this query; a remount or window focus must not refetch
      // the same id set (that produced duplicate per-page requests).
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });
  const value = useMemo(() => {
    const records = new Map<string, Record<string, unknown>>();
    for (const record of result.data ?? []) {
      const id = record?.id;
      if (id !== undefined && id !== null) records.set(String(id), record);
    }
    const merged = new Map(parent.records);
    merged.set(entry.resource, records);
    const pending = new Set(parent.pending);
    if (query.isPending) pending.add(entry.resource);
    else pending.delete(entry.resource);
    return { records: merged, pending };
  }, [parent, result.data, query.isPending, entry.resource]);
  return <RelationBatchContext.Provider value={value}>{children}</RelationBatchContext.Provider>;
}

/**
 * Provides already-fetched FK records to every `RelationCell` below it.
 *
 * Each plan entry becomes a nested provider whose `useMany` runs in its own
 * component instance (no conditional hooks), which also means the records are
 * available during the same render: the list page paints display text without a
 * per-cell loading pass. While a resource's batch is still fetching, its cells
 * keep their `useOne` fallback disabled too — otherwise the first paint would
 * fire exactly the per-cell requests this provider exists to avoid. Host
 * integrations may supply a data provider without a `getMany` method; those keep
 * the `useOne` fallback instead of failing.
 */
export function RelationBatchProvider({ plan, children }: { plan: ReadonlyArray<RelationBatchPlanEntry>; children: ReactNode }) {
  const getDataProvider = useDataProvider();
  const dataProvider = getDataProvider();
  if (typeof dataProvider.getMany !== "function") return <>{children}</>;
  let tree: ReactNode = children;
  for (let index = plan.length - 1; index >= 0; index -= 1) {
    const entry = plan[index]!;
    tree = <RelationBatchLayer key={entry.resource} entry={entry}>{tree}</RelationBatchLayer>;
  }
  return <>{tree}</>;
}

export interface BatchedRelation {
  /** The batched record, when the surrounding provider has loaded it. */
  record: Record<string, unknown> | undefined;
  /** True while this resource's batch is still loading; the caller must not fall back to `useOne`. */
  pending: boolean;
}

/** The batched record/loading state for a FK value, when the surrounding `RelationBatchProvider` covers it. */
export function useBatchedRelation(resource: string, id: string | undefined): BatchedRelation {
  const state = useContext(RelationBatchContext);
  if (!id) return { record: undefined, pending: false };
  return { record: state.records.get(resource)?.get(id), pending: state.pending.has(resource) };
}
