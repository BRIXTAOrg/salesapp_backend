import { strict as assert } from "node:assert";
import { fieldSubmissionConflict as check, readFieldProgressEpoch as epoch } from "../src/platform/fieldSyncGeneration";
const send = (appVersion: unknown, progressEpoch: unknown, currentEpoch = 0) =>
  check({ appVersion: 7, clientAppVersion: appVersion, progressEpoch: currentEpoch, clientProgressEpoch: progressEpoch });
assert.equal(epoch({}), 0);
assert.equal(epoch({ progressResetAt: "2026-10-09T00:00:00Z" }), 1);
assert.equal(epoch({ progressEpoch: 4, progressResetAt: "any" }), 4);
assert.equal(send(7, 0), null);
assert.equal(send(6, 0)?.code, "FIELD_APP_VERSION_CONFLICT");
assert.equal(send(7, 0, 1)?.code, "FIELD_PROGRESS_GENERATION_CONFLICT");
assert.equal(send(7, 1, 1), null);
assert.equal(send(undefined, undefined), null); // legacy untouched site
assert.equal(send(undefined, undefined, 1)?.code, "FIELD_PROGRESS_GENERATION_CONFLICT");
assert.equal(send(7, undefined, 1)?.code, "FIELD_PROGRESS_GENERATION_CONFLICT");
console.log("PASS: app-version conflicts, reset epochs, legacy untouched records, pre-reset retry rejection.");
