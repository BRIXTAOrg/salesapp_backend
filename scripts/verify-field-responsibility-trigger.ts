import assert from "node:assert/strict";
import { normalizePixelLogicProgram } from "../src/platform/pixelLogic/types";
import { runPixelLogic } from "../src/platform/pixelLogic/runtime";
import { validateFieldPixelLogic } from "../src/platform/fieldPixelLogic";

const graph = normalizePixelLogicProgram({
  enabled: true, version: 1, name: "Site becomes hot",
  nodes: [
    { id: "event", type: "event.record.updated", config: {} },
    { id: "answer", type: "value.ref", config: { scope: "capture", key: "temperature" } },
    { id: "hot", type: "value.literal", config: { value: "Hot" } },
    { id: "eq", type: "logic.compare", config: { operator: "eq" } },
    { id: "if", type: "control.if", config: {} },
    { id: "work", type: "effect.trigger_responsibility", config: { responsibilityKey: "site_follow_up" } },
  ],
  edges: [
    { id: "e1", kind: "flow", fromNodeId: "event", fromPort: "flow", toNodeId: "if", toPort: "flow" },
    { id: "e2", kind: "data", fromNodeId: "answer", fromPort: "value", toNodeId: "eq", toPort: "left" },
    { id: "e3", kind: "data", fromNodeId: "hot", fromPort: "value", toNodeId: "eq", toPort: "right" },
    { id: "e4", kind: "data", fromNodeId: "eq", fromPort: "value", toNodeId: "if", toPort: "condition" },
    { id: "e5", kind: "flow", fromNodeId: "if", fromPort: "true", toNodeId: "work", toPort: "flow" },
  ], variables: [], metadata: {},
}, "Work trigger test");
const stages = [{ key: "new" }];
assert.deepEqual(validateFieldPixelLogic(graph, stages), []);
const run = (temperature: string) => runPixelLogic(graph, {
  event: { name: "record.updated", payload: { recordId: "test" } },
  values: { capture: { temperature }, context: {}, state: { stage: "new" } },
});
assert.deepEqual(run("Hot").effects.map((e) => [e.kind, e.targetKey]), [
  ["trigger_responsibility", "site_follow_up"],
]);
assert.equal(run("Cold").effects.length, 0);
const bad = normalizePixelLogicProgram({ ...graph, nodes: [
  ...graph.nodes, { id: "delete", type: "effect.delete_record", config: {} },
] });
assert.ok(validateFieldPixelLogic(bad, stages).some((x) => x.includes("not allowed")));
const badKey = normalizePixelLogicProgram({ ...graph, nodes: graph.nodes.map(
  (n) => n.id === "work" ? { ...n, config: { responsibilityKey: "https://malicious.test" } } : n,
) });
assert.ok(validateFieldPixelLogic(badKey, stages).some((x) => x.includes("Responsibility key")));
console.log("PASS: conditional work trigger true/false, key validation, forbidden-effect rejection");
