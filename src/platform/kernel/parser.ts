import type {
  ResponsibilityKernel,
} from "./types";

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function looksLikeKernel(
  value: unknown,
): value is ResponsibilityKernel {
  const raw = objectValue(value);
  const runtimeWorld = objectValue(raw.runtimeWorld);

  return Number(raw.kernelVersion) >= 3 &&
    Array.isArray(runtimeWorld.actors) &&
    Array.isArray(runtimeWorld.objects) &&
    Array.isArray(runtimeWorld.contexts) &&
    Array.isArray(runtimeWorld.states) &&
    Array.isArray(raw.possibilities) &&
    Array.isArray(raw.events) &&
    Array.isArray(raw.rules);
}

/**
 * Accepts all locations used during the V2 -> Kernel V3/V4 transition.
 * The backend deliberately reads the published manifest first, but this
 * parser keeps old/local drafts compatible while the CMS settles on one
 * compiled contract.
 */
export function extractResponsibilityKernel(
  value: unknown,
): ResponsibilityKernel | null {
  if (looksLikeKernel(value)) {
    return value;
  }

  const raw = objectValue(value);
  const extension = objectValue(raw.extension);
  const metadata = objectValue(
    extension.metadata ??
      raw.metadata,
  );
  const app = objectValue(raw.app);
  const appConfig = objectValue(app.config);
  const runtime = objectValue(raw.runtime);

  const candidates = [
    metadata.responsibilityKernel,
    extension.responsibilityKernel,
    raw.responsibilityKernel,
    raw.kernel,
    appConfig.responsibilityKernel,
    runtime.kernel,
  ];

  for (const candidate of candidates) {
    if (looksLikeKernel(candidate)) {
      return candidate;
    }
  }

  return null;
}
