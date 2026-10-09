// BRIXTA_FIELD_PIXEL_PREVIEW_V1
// Read-only, synthetic dry-run of the exact backend Pixel Logic evaluator.
// No tenant DB, work-item insertion, notification, audit entry, or publish.
import { validateFieldPixelLogic } from "./fieldPixelLogic";
import { normalizePixelLogicProgram, type PixelLogicProgram } from "./pixelLogic/types";
import { runPixelLogic } from "./pixelLogic/runtime";

type Issue = { severity: "error" | "warning"; message: string; nodeId?: string };
type Ports = { inputs: { flow?: string[]; data?: string[] }; outputs: { flow?: string[]; data?: string[] } };
const PORTS: Record<string, Ports> = {
  "event.record.updated": { inputs: {}, outputs: { flow: ["flow"], data: ["record"] } },
  "value.ref": { inputs: {}, outputs: { data: ["value"] } },
  "value.literal": { inputs: {}, outputs: { data: ["value"] } },
  "logic.compare": { inputs: { data: ["left", "right"] }, outputs: { data: ["value"] } },
  "control.if": { inputs: { flow: ["flow"], data: ["condition"] }, outputs: { flow: ["true", "false"] } },
  "effect.change_state": { inputs: { flow: ["flow"] }, outputs: { flow: ["flow"] } },
  "effect.append_history": { inputs: { flow: ["flow"] }, outputs: { flow: ["flow"] } },
  "effect.trigger_responsibility": { inputs: { flow: ["flow"] }, outputs: { flow: ["flow"] } },
};

export function inspectFieldPixelGraph(program: PixelLogicProgram): Issue[] {
  const issues: Issue[] = [];
  const nodeMap = new Map(program.nodes.map(node => [node.id, node]));
  const start = program.nodes.filter(node => node.type === "event.record.updated");
  if (start.length !== 1) issues.push({ severity: "error", message: "Exactly one Record updated event is required for a Field graph." });

  const incoming = (id: string, kind: "flow" | "data", port?: string) => program.edges.filter(edge =>
    edge.toNodeId === id && edge.kind === kind && (!port || edge.toPort === port));
  const outgoing = (id: string, kind: "flow" | "data", port?: string) => program.edges.filter(edge =>
    edge.fromNodeId === id && edge.kind === kind && (!port || edge.fromPort === port));

  for (const edge of program.edges) {
    const from = nodeMap.get(edge.fromNodeId);
    const to = nodeMap.get(edge.toNodeId);
    if (!from || !to) continue; // Host validator reports missing nodes.
    const sourcePorts = PORTS[from.type]?.outputs[edge.kind];
    const targetPorts = PORTS[to.type]?.inputs[edge.kind];
    if (!sourcePorts?.includes(edge.fromPort) || !targetPorts?.includes(edge.toPort)) {
      issues.push({ severity: "error", nodeId: edge.toNodeId,
        message: `Connection ${edge.id} uses an invalid ${edge.kind} port (${edge.fromPort} → ${edge.toPort}).` });
    }
  }
  for (const node of program.nodes) {
    if (node.type === "logic.compare") {
      if (incoming(node.id, "data", "left").length !== 1) {
        issues.push({ severity: "error", nodeId: node.id, message: "Compare needs exactly one Left value." });
      }
      if (!(["exists", "not_exists"].includes(String(node.config.operator ?? "eq"))) &&
          incoming(node.id, "data", "right").length !== 1) {
        issues.push({ severity: "error", nodeId: node.id, message: "Compare needs exactly one Right value." });
      }
    }
    if (node.type === "control.if") {
      if (incoming(node.id, "data", "condition").length !== 1) {
        issues.push({ severity: "error", nodeId: node.id, message: "If / Else needs exactly one connected boolean condition." });
      }
      if (incoming(node.id, "flow", "flow").length !== 1) {
        issues.push({ severity: "error", nodeId: node.id, message: "If / Else needs exactly one incoming execution connection." });
      }
      if (!outgoing(node.id, "flow", "true").length) {
        issues.push({ severity: "warning", nodeId: node.id, message: "True branch is empty." });
      }
      if (!outgoing(node.id, "flow", "false").length) {
        issues.push({ severity: "warning", nodeId: node.id, message: "False branch is empty (no effect when condition is false)." });
      }
    }
    if (node.type === "event.record.updated" && !outgoing(node.id, "flow").length) {
      issues.push({ severity: "warning", nodeId: node.id, message: "The start event has no execution connection." });
    }
  }
  // Flow-only reachability: a disconnected effect will never execute.
  const reachable = new Set<string>();
  const walk = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const edge of outgoing(id, "flow")) walk(edge.toNodeId);
  };
  for (const node of start) walk(node.id);
  for (const node of program.nodes) {
    if (node.type.startsWith("effect.") && !reachable.has(node.id)) {
      issues.push({ severity: "warning", nodeId: node.id, message: `${node.label || node.type} cannot be reached from the start event.` });
    }
  }
  return issues.slice(0, 80);
}

export function previewFieldPixelLogic(input: {
  rawProgram: unknown;
  stages: Array<{ key: string }>;
  capture: Record<string, unknown>;
  sectionKey: string;
  currentStage: string;
}) {
  const program = normalizePixelLogicProgram(input.rawProgram, "Field preview");
  const hostIssues = validateFieldPixelLogic(program, input.stages);
  const diagnostics = inspectFieldPixelGraph(program);
  const errors = [...hostIssues, ...diagnostics.filter(x => x.severity === "error").map(x => x.message)];
  if (errors.length) return {
    ok: false as const, previewOnly: true as const, errors, diagnostics,
    error: "Fix graph errors before running the preview.",
  };
  try {
    // The preview deliberately evaluates a DISABLED draft without enabling it
    // on the persisted App Experience. No host effects are applied.
    const result = runPixelLogic({ ...program, enabled: true }, {
      event: { name: "record.updated", payload: { recordId: "preview-only", sectionKey: input.sectionKey }, at: "2026-01-01T00:00:00Z" },
      values: {
        capture: input.capture,
        context: { sectionKey: input.sectionKey },
        state: { stage: input.currentStage },
      },
    });
    const effects = result.effects.map(effect => ({
      nodeId: effect.nodeId,
      kind: effect.kind,
      targetKey: effect.targetKey ?? null,
      value: effect.value ?? null,
    }));
    let predictedStage = input.currentStage;
    const history: string[] = [];
    const wouldStartResponsibilities: string[] = [];
    for (const effect of effects) {
      if (effect.kind === "change_state") {
        const next = String(effect.value ?? "");
        if (!input.stages.some(stage => stage.key === next)) throw new Error("Invalid target stage in preview.");
        predictedStage = next;
      } else if (effect.kind === "append_history") {
        history.push(String(effect.value ?? ""));
      } else if (effect.kind === "trigger_responsibility") {
        wouldStartResponsibilities.push(String(effect.targetKey ?? ""));
      } else {
        throw new Error("Unapproved Field effect in preview.");
      }
    }
    return {
      ok: true as const,
      previewOnly: true as const,
      evaluatedDisabledDraft: !program.enabled,
      matched: result.matched,
      predictedStage,
      history,
      wouldStartResponsibilities,
      effects,
      trace: result.trace,
      diagnostics,
      errors: [] as string[],
    };
  } catch {
    return { ok: false as const, previewOnly: true as const,
      error: "The graph could not be evaluated. Check connections and node configuration.",
      errors: ["Pixel Logic evaluation failed."], diagnostics };
  }
}
