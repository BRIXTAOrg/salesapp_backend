import type { PixelLogicProgram } from "./pixelLogic/types";

/** Field App host safety boundary. No network, assignment, deletion, or foreign-record effects. */
export function validateFieldPixelLogic(
  program: PixelLogicProgram | null,
  stages: Array<{ key: string }>,
): string[] {
  if (!program) return [];
  const errors: string[] = [];
  const allowed = new Set([
    "event.record.updated", "value.ref", "value.literal",
    "logic.compare", "control.if", "effect.change_state",
    "effect.append_history", "effect.trigger_responsibility",
  ]);
  const stageKeys = new Set(stages.map((stage) => stage.key));
  if (program.nodes.length > 32 || program.edges.length > 64) {
    errors.push("Field Pixel Logic allows at most 32 nodes and 64 connections.");
  }
  if (program.nodes.length === 0 && program.enabled) {
    errors.push("Enabled Field Pixel Logic needs at least one node.");
  }
  if (program.nodes.filter((node) => node.type === "effect.trigger_responsibility").length > 3) {
    errors.push("A Field rule may start at most three Responsibilities.");
  }
  const nodes = new Map(program.nodes.map((node) => [node.id, node]));
  if (nodes.size !== program.nodes.length) errors.push("Pixel node IDs must be unique.");
  if (program.nodes.length && !program.nodes.some((node) => node.type === "event.record.updated")) {
    errors.push("Start with a Record updated event.");
  }
  for (const node of program.nodes) {
    if (!allowed.has(node.type)) {
      errors.push(`Node ${node.id}: ${node.type} is not allowed in Field Apps.`);
      continue;
    }
    if (node.type === "value.ref") {
      const scope = String(node.config.scope ?? "");
      const key = String(node.config.key ?? "");
      if (!(scope === "capture" || scope === "context" || scope === "state") ||
          !/^[a-zA-Z][a-zA-Z0-9_]{0,159}$/.test(key) ||
          key.startsWith("__") || node.config.path != null ||
          (scope === "context" && key !== "sectionKey") ||
          (scope === "state" && key !== "stage")) {
        errors.push(`Node ${node.id}: unsupported field reference.`);
      }
    }
    if (node.type === "logic.compare" &&
        !["eq", "neq", "gt", "gte", "lt", "lte", "exists", "not_exists", "contains"].includes(String(node.config.operator ?? "eq"))) {
      errors.push(`Node ${node.id}: comparison operator is not supported.`);
    }
    if (node.type === "effect.change_state" && !stageKeys.has(String(node.config.state ?? ""))) {
      errors.push(`Node ${node.id}: destination stage does not exist.`);
    }
    if (node.type === "effect.append_history" &&
        (typeof node.config.label !== "string" || !node.config.label.trim() || node.config.label.length > 160)) {
      errors.push(`Node ${node.id}: history label must be 1–160 characters.`);
    }
    // BRIXTA_FIELD_PIXEL_WORK_TRIGGER_V1: only a published Responsibility key,
    // never a URL, arbitrary employee ID, or service descriptor.
    if (node.type === "effect.trigger_responsibility" &&
        !/^[a-z][a-z0-9_-]{0,119}$/.test(String(node.config.responsibilityKey ?? ""))) {
      errors.push(`Node ${node.id}: supply a valid published Responsibility key.`);
    }
    if (node.type === "value.literal") {
      try {
        if ((JSON.stringify(node.config.value)?.length ?? 0) > 2048) {
          errors.push(`Node ${node.id}: literal is too large.`);
        }
      } catch {
        errors.push(`Node ${node.id}: literal is not JSON compatible.`);
      }
    }
  }
  const graph = new Map<string, string[]>();
  const seenEdges = new Set<string>();
  for (const edge of program.edges) {
    if (!nodes.has(edge.fromNodeId) || !nodes.has(edge.toNodeId)) {
      errors.push(`Connection ${edge.id}: missing node.`);
    }
    if (seenEdges.has(edge.id)) errors.push(`Connection ${edge.id} is duplicated.`);
    seenEdges.add(edge.id);
    if (!(["data", "flow"] as string[]).includes(edge.kind)) errors.push(`Connection ${edge.id}: invalid kind.`);
    graph.set(edge.fromNodeId, [...(graph.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  }
  const active = new Set<string>();
  const visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (active.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id); active.add(id);
    const found = (graph.get(id) ?? []).some(cycle);
    active.delete(id);
    return found;
  };
  if (program.nodes.some((node) => cycle(node.id))) errors.push("Field Pixel Logic cannot contain loops.");
  return errors;
}
