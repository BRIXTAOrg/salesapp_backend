import assert from "node:assert/strict";
import { runPixelLogic } from "../src/platform/pixelLogic/runtime";
import { validateFieldPixelLogic } from "../src/platform/fieldPixelLogic";
import type { PixelLogicProgram } from "../src/platform/pixelLogic/types";

const program: PixelLogicProgram = {
  version: 1, enabled: true, name: "Field stage test", variables: [], metadata: {},
  nodes: [
    { id: "event", type: "event.record.updated", config: {}, position: { x: 0, y: 0 } },
    { id: "answer", type: "value.ref", config: { scope: "capture", key: "lead_temperature" }, position: { x: 0, y: 100 } },
    { id: "literal", type: "value.literal", config: { value: "Hot" }, position: { x: 0, y: 200 } },
    { id: "compare", type: "logic.compare", config: { operator: "eq" }, position: { x: 100, y: 100 } },
    { id: "gate", type: "control.if", config: {}, position: { x: 200, y: 100 } },
    { id: "change", type: "effect.change_state", config: { state: "hot" }, position: { x: 300, y: 100 } },
    { id: "history", type: "effect.append_history", config: { label: "Hot lead detected" }, position: { x: 400, y: 100 } },
  ],
  edges: [
    { id:"e1", kind:"flow", fromNodeId:"event", fromPort:"flow", toNodeId:"gate", toPort:"flow" },
    { id:"e2", kind:"data", fromNodeId:"answer", fromPort:"value", toNodeId:"compare", toPort:"left" },
    { id:"e3", kind:"data", fromNodeId:"literal", fromPort:"value", toNodeId:"compare", toPort:"right" },
    { id:"e4", kind:"data", fromNodeId:"compare", fromPort:"value", toNodeId:"gate", toPort:"condition" },
    { id:"e5", kind:"flow", fromNodeId:"gate", fromPort:"true", toNodeId:"change", toPort:"flow" },
    { id:"e6", kind:"flow", fromNodeId:"change", fromPort:"flow", toNodeId:"history", toPort:"flow" },
  ],
};
const stages = [{ key: "new" }, { key: "hot" }];
assert.deepEqual(validateFieldPixelLogic(program, stages), []);
const hot = runPixelLogic(program, { event: { name: "record.updated" }, values: { capture: { lead_temperature: "Hot" } } });
assert.deepEqual(hot.effects.map((e) => e.kind), ["change_state", "append_history"]);
const cold = runPixelLogic(program, { event: { name: "record.updated" }, values: { capture: { lead_temperature: "Cold" } } });
assert.equal(cold.effects.length, 0);
const forbidden: PixelLogicProgram = { ...program, nodes: [...program.nodes, {
  id: "delete", type: "effect.delete_record", position: { x: 1, y: 1 }, config: {},
}] };
assert.ok(validateFieldPixelLogic(forbidden, stages).length > 0);
console.log("PASS: Field Pixel Logic true/false branches, stage and history effects, and forbidden effect rejection.");
