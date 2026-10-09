import { strict as assert } from "node:assert";
import { previewFieldPixelLogic, inspectFieldPixelGraph } from "../src/platform/fieldPixelPreview";
import type { PixelLogicProgram } from "../src/platform/pixelLogic/types";
const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id, type, position: { x: 0, y: 0 }, config,
});
const edge = (id: string, kind: "flow" | "data", fromNodeId: string, fromPort: string, toNodeId: string, toPort: string) =>
  ({ id, kind, fromNodeId, fromPort, toNodeId, toPort });
const program: PixelLogicProgram = {
  version: 1, enabled: false, name: "Preview test", variables: [], metadata: {},
  nodes: [
    node("event", "event.record.updated"),
    node("source", "value.ref", { scope: "capture", key: "customer_interest" }),
    node("expected", "value.literal", { value: "Hot" }),
    node("compare", "logic.compare", { operator: "eq" }),
    node("gate", "control.if"),
    node("work", "effect.trigger_responsibility", { responsibilityKey: "site_follow_up" }),
    node("history", "effect.append_history", { label: "Follow up required" }),
  ],
  edges: [
    edge("start", "flow", "event", "flow", "gate", "flow"),
    edge("left", "data", "source", "value", "compare", "left"),
    edge("right", "data", "expected", "value", "compare", "right"),
    edge("condition", "data", "compare", "value", "gate", "condition"),
    edge("true", "flow", "gate", "true", "work", "flow"),
    edge("history", "flow", "work", "flow", "history", "flow"),
  ],
};
const run = (capture: string, graph: PixelLogicProgram = program) => previewFieldPixelLogic({
  rawProgram: graph, stages: [{ key: "new" }, { key: "hot" }], capture: { customer_interest: capture },
  sectionKey: "visit", currentStage: "new",
});
const hot = run("Hot");
assert.equal(hot.ok, true);
assert.equal(hot.previewOnly, true);
if (!hot.ok) throw new Error("hot must run");
assert.equal(hot.matched, true);
assert.deepEqual(hot.wouldStartResponsibilities, ["site_follow_up"]);
assert.deepEqual(hot.history, ["Follow up required"]);
assert.equal(hot.evaluatedDisabledDraft, true);
const cold = run("Cold");
assert.equal(cold.ok, true);
if (!cold.ok) throw new Error("cold must run");
assert.deepEqual(cold.wouldStartResponsibilities, []);
assert.deepEqual(cold.history, []);
const missingCondition = { ...program, edges: program.edges.filter(item => item.id !== "condition") };
assert.equal(run("Hot", missingCondition).ok, false);
const invalidPort = { ...program, edges: program.edges.map(item => item.id === "left" ? { ...item, fromPort: "fake" } : item) };
assert.equal(run("Hot", invalidPort).ok, false);
const forbidden = { ...program, nodes: [...program.nodes, node("unsafe", "effect.delete_record")] };
assert.equal(run("Hot", forbidden).ok, false);
const warnings = inspectFieldPixelGraph(program);
assert.ok(warnings.some(item => item.severity === "warning" && item.message.includes("False branch")));
console.log("PASS: backend evaluator true/false dry runs, disabled draft, structural errors, forbidden effect, branch warnings.");
