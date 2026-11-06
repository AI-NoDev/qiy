import { expect, test } from "bun:test";
import { buildTree } from "../app/tree";

const rows = [
  { id: "root", parentId: null, name: "Root" },
  { id: "a", parentId: "root", name: "A" },
  { id: "b", parentId: "root", name: "B" },
  { id: "a1", parentId: "a", name: "A1" },
];

test("nests rows by their parent field", () => {
  const { nodes, orphans } = buildTree(rows, "parentId", "name");
  expect(nodes.map((node) => node.key)).toEqual(["root"]);
  expect(nodes[0]!.children.map((node) => node.key)).toEqual(["a", "b"]);
  expect(nodes[0]!.children[0]!.children.map((node) => node.key)).toEqual(["a1"]);
  expect(orphans).toEqual([]);
});

test("reports unknown parents, self references and cycles instead of looping", () => {
  const broken = [
    { id: "root", parentId: null, name: "Root" },
    { id: "lost", parentId: "ghost", name: "Lost" },
    { id: "self", parentId: "self", name: "Self" },
    { id: "x", parentId: "y", name: "X" },
    { id: "y", parentId: "x", name: "Y" },
  ];
  const { nodes, orphans } = buildTree(broken, "parentId", "name");
  expect(nodes.map((node) => node.key)).toEqual(["root"]);
  expect(orphans.map((row) => row.id).sort()).toEqual(["lost", "self", "x", "y"]);
});

test("handles empty and label fallbacks", () => {
  expect(buildTree([], "parentId", "name")).toEqual({ nodes: [], orphans: [] });
  const { nodes } = buildTree([{ id: "only", parentId: null }], "parentId", "name");
  expect(nodes[0]!.title).toBe("only");
});
