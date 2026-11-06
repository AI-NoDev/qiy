export interface QiyTreeNode<T> {
  key: string;
  title: string;
  record: T;
  children: QiyTreeNode<T>[];
}

/** Tree entities declared by scope ... tree <entity> <parentField>. */
export const treeParents: Record<string, { parentField: string; labelField: string }> = {};

/**
 * Builds a nested tree from flat rows. Missing parents, self references and cycles
 * are reported as orphans instead of being dropped silently or looping forever.
 */
export function buildTree<T extends Record<string, unknown>>(records: readonly T[], parentField: string, labelField: string): { nodes: Array<QiyTreeNode<T>>; orphans: T[] } {
  const byId = new Map<string, QiyTreeNode<T>>();
  for (const record of records) {
    const id = String(record.id ?? "");
    if (!id) continue;
    byId.set(id, { key: id, title: String(record[labelField] ?? id), record, children: [] });
  }
  const orphans: T[] = [];
  const placed = new Set<string>();
  for (const record of records) {
    const id = String(record.id ?? "");
    if (!id) continue;
    const parent = record[parentField];
    const parentId = parent === null || parent === undefined ? "" : String(parent);
    if (!parentId) { placed.add(id); continue; }
    // Self references and unknown parents cannot be attached anywhere.
    if (parentId === id || !byId.has(parentId)) { orphans.push(record); continue; }
    placed.add(id);
  }
  const roots: Array<QiyTreeNode<T>> = [];
  for (const record of records) {
    const id = String(record.id ?? "");
    if (!id || !placed.has(id)) continue;
    const node = byId.get(id)!;
    const parent = record[parentField];
    const parentId = parent === null || parent === undefined ? "" : String(parent);
    if (!parentId) { roots.push(node); continue; }
    byId.get(parentId)!.children.push(node);
  }
  // A cycle leaves nodes attached below each other with no root; surface them.
  const reachable = new Set<string>();
  const walk = (nodes: Array<QiyTreeNode<T>>) => { for (const node of nodes) { reachable.add(node.key); walk(node.children); } };
  walk(roots);
  for (const record of records) {
    const id = String(record.id ?? "");
    if (id && placed.has(id) && !reachable.has(id) && !orphans.includes(record)) orphans.push(record);
  }
  return { nodes: roots, orphans };
}
