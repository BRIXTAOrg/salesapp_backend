// BRIXTA_FIELD_SYNC_GENERATION_V1
// No cross-version merge, automatic reset replay or silent queued-data deletion.
function parsedInteger(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function readFieldProgressEpoch(fieldRaw: unknown): number {
  const field = fieldRaw && typeof fieldRaw === "object" && !Array.isArray(fieldRaw)
    ? fieldRaw as Record<string, unknown> : {};
  return parsedInteger(field.progressEpoch) ?? (field.progressResetAt ? 1 : 0);
}

export function fieldSubmissionConflict(input: {
  appVersion: number;
  clientAppVersion: unknown;
  progressEpoch: number;
  clientProgressEpoch: unknown;
}): { code: string; error: string } | null {
  const version = parsedInteger(input.clientAppVersion);
  const epoch = parsedInteger(input.clientProgressEpoch);
  if (version !== null && version !== input.appVersion) return {
    code: "FIELD_APP_VERSION_CONFLICT",
    error: "This App Experience changed since the step was opened. Refresh before submitting; your queued answers are retained on the phone.",
  };
  // Clients from before Phase 4B remain usable on untouched records, but may
  // NOT replay a pre-reset step, even if they do not send an epoch token.
  if (input.progressEpoch > 0 && (epoch !== input.progressEpoch || version === null)) return {
    code: "FIELD_PROGRESS_GENERATION_CONFLICT",
    error: "Verification steps were restarted. Refresh this record; do not replay an old offline submission.",
  };
  if (epoch !== null && epoch !== input.progressEpoch) return {
    code: "FIELD_PROGRESS_GENERATION_CONFLICT",
    error: "This record's verification generation changed. Refresh before submitting.",
  };
  return null;
}
