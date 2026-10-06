/*
 * BRIXTA_FIELD_APP_CONTRACT_V2
 *
 * The one definition of a field app: which inputs exist, how a config is
 * cleaned, what makes it publishable, how answers are validated, when a
 * field is shown, how calculated values are worked out and how a record
 * moves through its stages.
 *
 * This file is byte-identical in:
 *   salesman_cms/src/lib/field-app-contract.ts
 *   salesapp_backend/src/platform/fieldAppContract.ts
 * The BRIXTA step scripts always ship both together. No imports on purpose,
 * so it runs the same in Next.js and in Express.
 *
 * Stored shape (entity_types.config):
 *   fieldApp         the PUBLISHED config phones use (with version/publishedAt)
 *   fieldAppDraft    { config, revision, updatedAt, updatedBy, basedOnVersion }
 *   fieldAppHistory  last published versions, newest first
 */

export const FIELD_APP_CONTRACT_VERSION = 2;

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export type FieldInputType =
  | "text"
  | "long_text"
  | "number"
  | "currency"
  | "phone"
  | "email"
  | "date"
  | "time"
  | "choice"
  | "multi_choice"
  | "yes_no"
  | "checkbox"
  | "rating"
  | "photos"
  | "signature"
  | "gps"
  | "calculated"
  | "note";

export type FieldInputGroup = "basic" | "choice" | "media" | "smart" | "layout";

export type FieldInputSpec = {
  type: FieldInputType;
  label: string;
  description: string;
  group: FieldInputGroup;
  /** false for layout blocks that never store a value */
  collects: boolean;
  /** column type used when the input is added to the list */
  dataType: "text" | "number" | "date" | "boolean" | "media" | "location_point" | null;
  numeric: boolean;
};

export const FIELD_INPUT_CATALOG: FieldInputSpec[] = [
  { type: "text", label: "Short text", description: "A name, a short answer", group: "basic", collects: true, dataType: "text", numeric: false },
  { type: "long_text", label: "Long text", description: "Notes, remarks, descriptions", group: "basic", collects: true, dataType: "text", numeric: false },
  { type: "number", label: "Number", description: "Quantities, counts, sizes", group: "basic", collects: true, dataType: "number", numeric: true },
  { type: "currency", label: "Amount", description: "Money, with a currency sign", group: "basic", collects: true, dataType: "number", numeric: true },
  { type: "phone", label: "Phone", description: "Mobile or landline number", group: "basic", collects: true, dataType: "text", numeric: false },
  { type: "email", label: "Email", description: "Checked email address", group: "basic", collects: true, dataType: "text", numeric: false },
  { type: "date", label: "Date", description: "Calendar with quick picks", group: "basic", collects: true, dataType: "date", numeric: false },
  { type: "time", label: "Time", description: "Hour and minute", group: "basic", collects: true, dataType: "text", numeric: false },
  { type: "choice", label: "Single choice", description: "Pick one option", group: "choice", collects: true, dataType: "text", numeric: false },
  { type: "multi_choice", label: "Multiple choice", description: "Pick any options", group: "choice", collects: true, dataType: "text", numeric: false },
  { type: "yes_no", label: "Yes / No", description: "Two big buttons", group: "choice", collects: true, dataType: "text", numeric: false },
  { type: "checkbox", label: "Tick box", description: "Confirm something", group: "choice", collects: true, dataType: "boolean", numeric: false },
  { type: "rating", label: "Rating", description: "Stars, 1 to 5 by default", group: "choice", collects: true, dataType: "number", numeric: true },
  { type: "photos", label: "Photos", description: "Camera photos as evidence", group: "media", collects: true, dataType: "media", numeric: false },
  { type: "signature", label: "Signature", description: "Sign on the screen", group: "media", collects: true, dataType: "media", numeric: false },
  { type: "gps", label: "GPS check-in", description: "Proves where the visit happened", group: "media", collects: true, dataType: "location_point", numeric: false },
  { type: "calculated", label: "Calculated", description: "Worked out from other numbers", group: "smart", collects: true, dataType: "number", numeric: true },
  { type: "note", label: "Info text", description: "A heading or instructions", group: "layout", collects: false, dataType: null, numeric: false },
];

const INPUT_TYPES = FIELD_INPUT_CATALOG.map((spec) => spec.type);

export function inputSpec(type: string): FieldInputSpec {
  return FIELD_INPUT_CATALOG.find((spec) => spec.type === type) ?? FIELD_INPUT_CATALOG[0];
}

export type ConditionOp = "is" | "is_not" | "any_of" | "filled" | "empty";

export type FieldCondition = {
  field: string;
  op: ConditionOp;
  values: string[];
};

export type FieldInput = {
  key: string;
  label: string;
  type: FieldInputType;
  required: boolean;
  options: string[];
  placeholder: string | null;
  unit: string | null;
  /** small help text under the label (the body text for "note") */
  help: string | null;
  /** number / currency / rating limits; rating uses max as star count */
  min: number | null;
  max: number | null;
  /** photos: how many may be added (1-10) */
  maxPhotos: number;
  /** calculated: e.g. "order_quantity * rate" */
  formula: string | null;
  /** calculated: decimals to keep (0-4) */
  decimals: number;
  /** only shown (and only required) when this is true */
  showWhen: FieldCondition | null;
};

export type FieldStageRule = {
  field: string;
  equals: string;
  stage: string;
};

export type FieldSection = {
  key: string;
  title: string;
  hint: string | null;
  requires: string[];
  setsStage: string | null;
  stageWhen: FieldStageRule[];
  fields: FieldInput[];
};

export type FieldStageTone = "neutral" | "info" | "good" | "warning" | "danger";

export type FieldStage = {
  key: string;
  label: string;
  tone: FieldStageTone;
  closed: boolean;
  terminal: boolean;
};

export type FieldAppConfig = {
  enabled: boolean;
  template: string | null;
  title: string;
  titleField: string | null;
  subtitleFields: string[];
  priorityField: string | null;
  locationField: string | null;
  followUpField: string | null;
  tableFields: string[];
  stages: FieldStage[];
  sections: FieldSection[];
  /** set when published */
  version: number;
  publishedAt: string | null;
  publishedBy: string | null;
  contractVersion: number;
};

export type FieldState = {
  stage: string;
  stageChangedAt: string | null;
  sections: Record<string, { completedAt: string; byUserId: number; byName: string | null }>;
  lastVisitAt: string | null;
  lastVisitBy: string | null;
  followUpAt: string | null;
  mutations: string[];
  /** Set by the CMS (Field work → Assign). */
  assignee: { userId: number; name: string } | null;
};

const TONES: FieldStageTone[] = ["neutral", "info", "good", "warning", "danger"];
const OPS: ConditionOp[] = ["is", "is_not", "any_of", "filled", "empty"];

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,159}$/;

export const MAX_TEXT = 2_000;
export const MAX_PHOTOS = 10;
export const MAX_SECTIONS = 20;
export const MAX_FIELDS_PER_SECTION = 40;
export const MAX_STAGES = 20;

export const DEFAULT_STAGES: FieldStage[] = [
  { key: "new", label: "Not visited", tone: "neutral", closed: false, terminal: false },
  { key: "visited", label: "Visited", tone: "neutral", closed: false, terminal: false },
  { key: "verified", label: "Verified", tone: "info", closed: false, terminal: false },
  { key: "contacted", label: "Contact added", tone: "info", closed: false, terminal: false },
  { key: "pitched", label: "Pitched", tone: "warning", closed: false, terminal: false },
  { key: "follow_up", label: "Follow-up", tone: "warning", closed: false, terminal: false },
  { key: "won", label: "Order", tone: "good", closed: true, terminal: true },
  { key: "lost", label: "Lost", tone: "danger", closed: true, terminal: false },
  { key: "not_a_site", label: "Not a site", tone: "neutral", closed: true, terminal: false },
];

/* ------------------------------------------------------------------ */
/* Cleaning a config                                                    */
/* ------------------------------------------------------------------ */

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fieldKey(value: unknown): string | null {
  const candidate = text(value, 160);
  return FIELD_KEY_PATTERN.test(candidate) ? candidate : null;
}

function list<T>(value: unknown, map: (item: unknown) => T | null, max: number): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value.slice(0, max)) {
    const mapped = map(item);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = finiteOrNull(value);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeCondition(raw: unknown): FieldCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const field = fieldKey(item.field);
  if (!field) return null;
  // v1 shape { field, equals } is accepted too.
  const op: ConditionOp = OPS.includes(item.op as ConditionOp)
    ? (item.op as ConditionOp)
    : item.equals !== undefined
      ? "is"
      : "filled";
  const rawValues = Array.isArray(item.values)
    ? item.values
    : item.equals !== undefined
      ? [item.equals]
      : item.value !== undefined
        ? [item.value]
        : [];
  const values = rawValues
    .map((value) => (typeof value === "boolean" ? (value ? "Yes" : "No") : text(String(value ?? ""), 120)))
    .filter(Boolean)
    .slice(0, 20);
  if ((op === "is" || op === "is_not" || op === "any_of") && values.length === 0) return null;
  return { field, op, values: op === "filled" || op === "empty" ? [] : values };
}

export function normalizeInput(raw: unknown): FieldInput | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const key = fieldKey(item.key);
  if (!key) return null;
  const type = INPUT_TYPES.includes(item.type as FieldInputType)
    ? (item.type as FieldInputType)
    : "text";
  const spec = inputSpec(type);
  const options = [
    ...new Set(list(item.options, (option) => text(option, 120) || null, 50)),
  ];
  let min = finiteOrNull(item.min);
  let max = finiteOrNull(item.max);
  if (type === "rating") {
    min = 1;
    max = clampInt(item.max, 3, 10, 5);
  }
  if (min !== null && max !== null && min > max) [min, max] = [max, min];

  return {
    key,
    label: text(item.label) || key,
    type,
    required: spec.collects && type !== "calculated" && item.required === true,
    options: type === "choice" || type === "multi_choice" ? options : [],
    placeholder: text(item.placeholder) || null,
    unit: text(item.unit, 20) || null,
    help: text(item.help, type === "note" ? 1_000 : 300) || null,
    min: spec.numeric ? min : null,
    max: spec.numeric ? max : null,
    maxPhotos: type === "photos" ? clampInt(item.maxPhotos, 1, MAX_PHOTOS, MAX_PHOTOS) : type === "signature" ? 1 : 0,
    formula: type === "calculated" ? text(item.formula, 300) || null : null,
    decimals: type === "calculated" ? clampInt(item.decimals, 0, 4, 2) : 0,
    showWhen: normalizeCondition(item.showWhen),
  };
}

function normalizeRule(raw: unknown): FieldStageRule | null {
  if (!raw || typeof raw !== "object") return null;
  const rule = raw as Record<string, unknown>;
  const field = fieldKey(rule.field);
  const stage = fieldKey(rule.stage);
  const equals = text(rule.equals, 120);
  return field && stage && equals ? { field, stage, equals } : null;
}

export function normalizeSection(raw: unknown): FieldSection | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const key = fieldKey(item.key);
  if (!key) return null;
  return {
    key,
    title: text(item.title) || key,
    hint: text(item.hint, 300) || null,
    requires: list(item.requires, fieldKey, 10).filter((value) => value !== key),
    setsStage: fieldKey(item.setsStage),
    stageWhen: list(item.stageWhen, normalizeRule, 10),
    fields: list(item.fields, normalizeInput, MAX_FIELDS_PER_SECTION),
  };
}

export function normalizeStage(raw: unknown): FieldStage | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const key = fieldKey(item.key);
  if (!key) return null;
  const terminal = item.terminal === true;
  return {
    key,
    label: text(item.label) || key,
    tone: TONES.includes(item.tone as FieldStageTone) ? (item.tone as FieldStageTone) : "neutral",
    closed: item.closed === true || terminal,
    terminal,
  };
}

/**
 * Cleans any stored or submitted config. Never throws, never returns null:
 * drafts can be half-finished. Use checkFieldApp() before publishing.
 */
export function normalizeFieldApp(raw: unknown, entityTitle: string): FieldAppConfig {
  const config = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const seenSections = new Set<string>();
  const sections = list(config.sections, normalizeSection, MAX_SECTIONS).filter((section) => {
    if (seenSections.has(section.key)) return false;
    seenSections.add(section.key);
    return true;
  });

  const seenStages = new Set<string>();
  let stages = list(config.stages, normalizeStage, MAX_STAGES).filter((stage) => {
    if (seenStages.has(stage.key)) return false;
    seenStages.add(stage.key);
    return true;
  });
  if (stages.length === 0) stages = DEFAULT_STAGES.map((stage) => ({ ...stage }));
  if (!stages.some((stage) => stage.key === "new")) {
    stages = [{ ...DEFAULT_STAGES[0] }, ...stages];
  }

  return {
    enabled: config.enabled !== false,
    template: text(config.template, 80) || null,
    title: text(config.title) || entityTitle,
    titleField: fieldKey(config.titleField),
    subtitleFields: list(config.subtitleFields, fieldKey, 4),
    priorityField: fieldKey(config.priorityField),
    locationField: fieldKey(config.locationField),
    followUpField: fieldKey(config.followUpField),
    tableFields: list(config.tableFields, fieldKey, 6),
    stages,
    sections,
    version: clampInt(config.version, 0, 1_000_000, 0),
    publishedAt: text(config.publishedAt, 40) || null,
    publishedBy: text(config.publishedBy, 120) || null,
    contractVersion: FIELD_APP_CONTRACT_VERSION,
  };
}

/** The published config phones use, or null when the list is not in the app. */
export function readFieldAppConfig(entityConfig: unknown, entityTitle: string): FieldAppConfig | null {
  if (!entityConfig || typeof entityConfig !== "object") return null;
  const raw = (entityConfig as Record<string, unknown>).fieldApp;
  if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).enabled !== true) {
    return null;
  }
  const config = normalizeFieldApp(raw, entityTitle);
  const usable = config.sections.filter((section) =>
    section.fields.some((field) => inputSpec(field.type).collects),
  );
  if (usable.length === 0) return null;
  return { ...config, enabled: true, sections: usable };
}

export function allInputs(config: Pick<FieldAppConfig, "sections">): FieldInput[] {
  return config.sections.flatMap((section) => section.fields);
}

/* ------------------------------------------------------------------ */
/* Publish checks                                                       */
/* ------------------------------------------------------------------ */

export type ConfigProblem = {
  /** e.g. "sections.verify.fields.site_status" */
  path: string;
  message: string;
};

/** Everything that must be right before phones get this config. */
export function checkFieldApp(config: FieldAppConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });

  if (config.sections.length === 0) {
    add("sections", "Add at least one step.");
  }

  const sectionKeys = new Set(config.sections.map((section) => section.key));
  const stageKeys = new Set(config.stages.map((stage) => stage.key));
  const seenFields = new Map<string, string>();
  const order = new Map<string, { section: number; index: number; field: FieldInput }>();

  config.sections.forEach((section, sectionIndex) => {
    section.fields.forEach((field, index) => {
      const owner = seenFields.get(field.key);
      if (owner) {
        add(
          `sections.${section.key}.fields.${field.key}`,
          `"${field.label}" uses the same key as a question in "${owner}". Keys must be unique.`,
        );
      } else {
        seenFields.set(field.key, section.title);
        order.set(field.key, { section: sectionIndex, index, field });
      }
    });
  });

  for (const section of config.sections) {
    const base = `sections.${section.key}`;
    if (!section.fields.some((field) => inputSpec(field.type).collects)) {
      add(base, `"${section.title}" has no questions yet.`);
    }
    for (const required of section.requires) {
      if (!sectionKeys.has(required)) add(`${base}.requires`, `"${section.title}" waits for a step that no longer exists.`);
    }
    if (section.setsStage && !stageKeys.has(section.setsStage)) {
      add(`${base}.setsStage`, `"${section.title}" moves records to a stage that doesn't exist.`);
    }
    for (const rule of section.stageWhen) {
      if (!section.fields.some((field) => field.key === rule.field)) {
        add(`${base}.stageWhen`, `A stage rule in "${section.title}" looks at a question that isn't in this step.`);
      }
      if (!stageKeys.has(rule.stage)) {
        add(`${base}.stageWhen`, `A stage rule in "${section.title}" moves to a stage that doesn't exist.`);
      }
    }

    section.fields.forEach((field, index) => {
      const path = `${base}.fields.${field.key}`;
      const position = order.get(field.key);
      if (!position || position.field !== field) return;

      if ((field.type === "choice" || field.type === "multi_choice") && field.options.length < 2) {
        add(path, `"${field.label}" needs at least two options.`);
      }

      if (field.showWhen) {
        const target = order.get(field.showWhen.field);
        if (!target) {
          add(path, `"${field.label}" is shown based on a question that doesn't exist.`);
        } else if (field.showWhen.field === field.key) {
          add(path, `"${field.label}" can't depend on itself.`);
        } else if (target.section === position.section && target.index > index) {
          add(path, `"${field.label}" depends on "${target.field.label}", which comes after it. Move it below.`);
        } else if (!inputSpec(target.field.type).collects) {
          add(path, `"${field.label}" depends on info text, which has no answer.`);
        }
      }

      if (field.type === "calculated") {
        if (!field.formula) {
          add(path, `"${field.label}" needs a formula.`);
        } else {
          const parsed = parseFormula(field.formula);
          if (!parsed.ok) {
            add(path, `"${field.label}": ${parsed.error}`);
          } else {
            for (const ref of parsed.refs) {
              const target = order.get(ref);
              if (!target) {
                add(path, `"${field.label}" uses "${ref}", which isn't a question in this app.`);
              } else if (!inputSpec(target.field.type).numeric) {
                add(path, `"${field.label}" uses "${target.field.label}", which isn't a number.`);
              } else if (ref === field.key) {
                add(path, `"${field.label}" can't use itself.`);
              } else if (target.section === position.section && target.index > index) {
                add(path, `"${field.label}" uses "${target.field.label}", which comes after it. Move it below.`);
              }
            }
          }
        }
      }
    });
  }

  // Steps waiting on each other in a circle would lock forever.
  const waitsOn = new Map(config.sections.map((section) => [section.key, section.requires]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const cycle = (key: string): boolean => {
    if (done.has(key)) return false;
    if (visiting.has(key)) return true;
    visiting.add(key);
    const found = (waitsOn.get(key) ?? []).some(cycle);
    visiting.delete(key);
    done.add(key);
    return found;
  };
  for (const section of config.sections) {
    if (cycle(section.key)) {
      add(`sections.${section.key}.requires`, "Some steps wait for each other in a circle, so none could ever be opened.");
      break;
    }
  }

  if (config.followUpField && !seenFields.has(config.followUpField)) {
    add("followUpField", "The follow-up date points at a question that doesn't exist.");
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* Conditions                                                           */
/* ------------------------------------------------------------------ */

function answerTokens(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "boolean") return [value ? "Yes" : "No"];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "object") return ["(set)"];
  const single = String(value).trim();
  return single ? [single] : [];
}

export function conditionMet(condition: FieldCondition, values: Record<string, unknown>): boolean {
  const tokens = answerTokens(values[condition.field]);
  const lower = tokens.map((token) => token.toLowerCase());
  const wanted = condition.values.map((value) => value.toLowerCase());
  switch (condition.op) {
    case "filled":
      return tokens.length > 0;
    case "empty":
      return tokens.length === 0;
    case "is":
      return wanted.length > 0 && lower.includes(wanted[0]);
    case "is_not":
      return wanted.length > 0 && !lower.includes(wanted[0]);
    case "any_of":
      return wanted.some((value) => lower.includes(value));
    default:
      return true;
  }
}

export function isFieldVisible(field: FieldInput, values: Record<string, unknown>): boolean {
  return !field.showWhen || conditionMet(field.showWhen, values);
}

export function describeCondition(condition: FieldCondition, labelOf: (key: string) => string): string {
  const name = labelOf(condition.field);
  switch (condition.op) {
    case "filled":
      return `${name} is answered`;
    case "empty":
      return `${name} is not answered`;
    case "is":
      return `${name} is ${condition.values[0]}`;
    case "is_not":
      return `${name} is not ${condition.values[0]}`;
    default:
      return `${name} is ${condition.values.join(" or ")}`;
  }
}

/* ------------------------------------------------------------------ */
/* Formulas: numbers, question keys, + - * / and brackets               */
/* ------------------------------------------------------------------ */

type Token =
  | { kind: "num"; value: number }
  | { kind: "ref"; key: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "open" }
  | { kind: "close" };

type Node =
  | { kind: "num"; value: number }
  | { kind: "ref"; key: string }
  | { kind: "neg"; inner: Node }
  | { kind: "bin"; op: "+" | "-" | "*" | "/"; left: Node; right: Node };

function tokenize(formula: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === " " || ch === "\t") {
      i += 1;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < formula.length && /[0-9.]/.test(formula[j])) j += 1;
      const value = Number(formula.slice(i, j));
      if (!Number.isFinite(value)) return `"${formula.slice(i, j)}" is not a number.`;
      tokens.push({ kind: "num", value });
      i = j;
    } else if (/[a-z]/.test(ch)) {
      let j = i;
      while (j < formula.length && /[a-z0-9_]/.test(formula[j])) j += 1;
      tokens.push({ kind: "ref", key: formula.slice(i, j) });
      i = j;
    } else if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", value: ch });
      i += 1;
    } else if (ch === "×") {
      tokens.push({ kind: "op", value: "*" });
      i += 1;
    } else if (ch === "(") {
      tokens.push({ kind: "open" });
      i += 1;
    } else if (ch === ")") {
      tokens.push({ kind: "close" });
      i += 1;
    } else {
      return `"${ch}" can't be used in a formula. Use numbers, question keys, + - * / and brackets.`;
    }
  }
  return tokens;
}

export function parseFormula(
  formula: string,
): { ok: true; refs: string[]; node: Node } | { ok: false; error: string } {
  const tokens = tokenize(formula.trim());
  if (typeof tokens === "string") return { ok: false, error: tokens };
  if (tokens.length === 0) return { ok: false, error: "The formula is empty." };
  if (tokens.length > 120) return { ok: false, error: "The formula is too long." };

  let position = 0;
  const refs = new Set<string>();
  const peek = () => tokens[position];

  const primary = (): Node | string => {
    const token = peek();
    if (!token) return "The formula ends too early.";
    if (token.kind === "op" && token.value === "-") {
      position += 1;
      const inner = primary();
      return typeof inner === "string" ? inner : { kind: "neg", inner };
    }
    if (token.kind === "num") {
      position += 1;
      return { kind: "num", value: token.value };
    }
    if (token.kind === "ref") {
      position += 1;
      refs.add(token.key);
      return { kind: "ref", key: token.key };
    }
    if (token.kind === "open") {
      position += 1;
      const inner = sum();
      if (typeof inner === "string") return inner;
      if (peek()?.kind !== "close") return "A bracket is not closed.";
      position += 1;
      return inner;
    }
    return "Something is missing between the signs.";
  };

  const product = (): Node | string => {
    let left = primary();
    while (typeof left !== "string") {
      const token = peek();
      if (!token || token.kind !== "op" || (token.value !== "*" && token.value !== "/")) break;
      position += 1;
      const right = primary();
      if (typeof right === "string") return right;
      left = { kind: "bin", op: token.value, left, right };
    }
    return left;
  };

  const sum = (): Node | string => {
    let left = product();
    while (typeof left !== "string") {
      const token = peek();
      if (!token || token.kind !== "op" || (token.value !== "+" && token.value !== "-")) break;
      position += 1;
      const right = product();
      if (typeof right === "string") return right;
      left = { kind: "bin", op: token.value, left, right };
    }
    return left;
  };

  const node = sum();
  if (typeof node === "string") return { ok: false, error: node };
  if (position < tokens.length) return { ok: false, error: "There is something extra at the end of the formula." };
  return { ok: true, refs: [...refs], node };
}

function evaluateNode(node: Node, values: Record<string, unknown>): number | null {
  switch (node.kind) {
    case "num":
      return node.value;
    case "ref":
      return toNumber(values[node.key]);
    case "neg": {
      const inner = evaluateNode(node.inner, values);
      return inner === null ? null : -inner;
    }
    case "bin": {
      const left = evaluateNode(node.left, values);
      const right = evaluateNode(node.right, values);
      if (left === null || right === null) return null;
      if (node.op === "+") return left + right;
      if (node.op === "-") return left - right;
      if (node.op === "*") return left * right;
      return right === 0 ? null : left / right;
    }
  }
}

/** null when an input is missing or the maths is impossible (÷ 0). */
export function evaluateFormula(
  formula: string | null,
  values: Record<string, unknown>,
  decimals = 2,
): number | null {
  if (!formula) return null;
  const parsed = parseFormula(formula);
  if (!parsed.ok) return null;
  const result = evaluateNode(parsed.node, values);
  if (result === null || !Number.isFinite(result)) return null;
  const factor = 10 ** Math.min(4, Math.max(0, decimals));
  return Math.round(result * factor) / factor;
}

/* ------------------------------------------------------------------ */
/* Answers                                                              */
/* ------------------------------------------------------------------ */

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[,\s₹$€£]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export type ValueProblem = { field: string; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function isEmpty(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function mediaUrls(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? "").trim())
    .filter((item) => /^https?:\/\//i.test(item) && item.length <= 2_000);
}

/**
 * Validates and normalizes what the phone sent for one step.
 *
 * `context` is the record's current data, so "show this only when ..." can
 * look at answers from earlier steps. Hidden questions are never required
 * and any old answer they had is cleared. Calculated questions are always
 * worked out here; whatever the phone sent for them is ignored.
 *
 * Keys the phone did not send are left untouched.
 */
export function cleanSectionValues(
  section: FieldSection,
  input: unknown,
  sitePoint: { lat: number; lng: number } | null,
  context: Record<string, unknown> = {},
): { values: Record<string, unknown>; problems: ValueProblem[] } {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const values: Record<string, unknown> = {};
  const problems: ValueProblem[] = [];
  const current: Record<string, unknown> = { ...context };

  for (const field of section.fields) {
    if (field.type === "note") continue;

    if (!isFieldVisible(field, current)) {
      if (!isEmpty(context[field.key]) || Object.prototype.hasOwnProperty.call(raw, field.key)) {
        values[field.key] = null;
      }
      current[field.key] = null;
      continue;
    }

    if (field.type === "calculated") {
      const result = evaluateFormula(field.formula, current, field.decimals);
      values[field.key] = result;
      current[field.key] = result;
      continue;
    }

    const has = Object.prototype.hasOwnProperty.call(raw, field.key);
    if (!has) {
      if (field.required && isEmpty(context[field.key])) {
        problems.push({ field: field.key, message: `${field.label} is required.` });
      }
      continue;
    }

    const value = raw[field.key];
    const unticked = field.type === "checkbox" && (value === false || value === "false" || value === "No");

    if (isEmpty(value) || (unticked && field.required)) {
      if (field.required) {
        problems.push({
          field: field.key,
          message: field.type === "checkbox" ? `${field.label} needs to be ticked.` : `${field.label} is required.`,
        });
      } else {
        values[field.key] = field.type === "checkbox" ? false : null;
        current[field.key] = values[field.key];
      }
      continue;
    }

    const problem = (message: string) => problems.push({ field: field.key, message });
    const accept = (next: unknown) => {
      values[field.key] = next;
      current[field.key] = next;
    };

    switch (field.type) {
      case "number":
      case "currency": {
        const parsed = toNumber(value);
        if (parsed === null) problem(`${field.label} must be a number.`);
        else if (field.min !== null && parsed < field.min) problem(`${field.label} must be at least ${field.min}.`);
        else if (field.max !== null && parsed > field.max) problem(`${field.label} must be at most ${field.max}.`);
        else accept(parsed);
        break;
      }
      case "rating": {
        const parsed = toNumber(value);
        const top = field.max ?? 5;
        if (parsed === null || !Number.isInteger(parsed) || parsed < 1 || parsed > top) {
          problem(`${field.label} must be between 1 and ${top}.`);
        } else accept(parsed);
        break;
      }
      case "date": {
        const parsed = new Date(String(value));
        if (Number.isNaN(parsed.getTime())) problem(`${field.label} is not a valid date.`);
        else accept(parsed.toISOString().slice(0, 10));
        break;
      }
      case "time": {
        const match = TIME.exec(String(value).trim());
        if (!match) problem(`${field.label} is not a valid time.`);
        else accept(`${match[1].padStart(2, "0")}:${match[2]}`);
        break;
      }
      case "email": {
        const email = String(value).trim().toLowerCase().slice(0, 200);
        if (!EMAIL.test(email)) problem(`${field.label} is not a valid email address.`);
        else accept(email);
        break;
      }
      case "yes_no": {
        const normalized = String(value).toLowerCase();
        if (value === true || ["yes", "true", "y"].includes(normalized)) accept("Yes");
        else if (value === false || ["no", "false", "n"].includes(normalized)) accept("No");
        else problem(`${field.label} must be yes or no.`);
        break;
      }
      case "checkbox": {
        const normalized = String(value).toLowerCase();
        accept(value === true || ["true", "yes", "1", "on"].includes(normalized));
        break;
      }
      case "choice": {
        const choice = String(value).trim();
        if (field.options.length > 0 && !field.options.includes(choice)) {
          problem(`Pick one of the options for ${field.label}.`);
        } else accept(choice.slice(0, 120));
        break;
      }
      case "multi_choice": {
        const picked = (Array.isArray(value) ? value : [value]).map((item) => String(item).trim()).filter(Boolean);
        const invalid = field.options.length > 0 && picked.some((item) => !field.options.includes(item));
        if (invalid) problem(`Pick from the options for ${field.label}.`);
        else accept([...new Set(picked)].slice(0, 20));
        break;
      }
      case "photos": {
        const urls = mediaUrls(value);
        if (urls.length === 0) problem(`${field.label}: photos were not uploaded.`);
        else accept(urls.slice(0, field.maxPhotos || MAX_PHOTOS));
        break;
      }
      case "signature": {
        const urls = mediaUrls(value);
        if (urls.length === 0) problem(`${field.label}: the signature was not uploaded.`);
        else accept(urls[0]);
        break;
      }
      case "gps": {
        const point = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const lat = toNumber(point.lat);
        const lng = toNumber(point.lng);
        if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          problem(`${field.label} is not a valid location.`);
        } else {
          const accuracy = toNumber(point.accuracy);
          accept({
            lat,
            lng,
            accuracy: accuracy === null ? null : Math.round(accuracy),
            capturedAt:
              typeof point.capturedAt === "string" && !Number.isNaN(Date.parse(point.capturedAt))
                ? point.capturedAt
                : new Date().toISOString(),
            distanceFromSiteM: sitePoint ? Math.round(distanceMeters(sitePoint, { lat, lng })) : null,
          });
        }
        break;
      }
      case "phone": {
        const phone = String(value).replace(/[^\d+]/g, "").slice(0, 20);
        if (phone.replace(/\D/g, "").length < 6) problem(`${field.label} looks too short.`);
        else accept(phone);
        break;
      }
      default:
        accept(String(value).trim().slice(0, field.type === "long_text" ? MAX_TEXT : 300));
    }
  }

  return { values, problems };
}

/** A short human answer, e.g. for timelines and tables. */
export function answerText(field: Pick<FieldInput, "type" | "unit" | "max">, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "photos": {
      const count = Array.isArray(value) ? value.length : 0;
      return count ? `${count} photo${count === 1 ? "" : "s"}` : "";
    }
    case "signature":
      return typeof value === "string" && value ? "Signed" : "";
    case "checkbox":
      return value === true ? "Yes" : value === false ? "No" : "";
    case "rating": {
      const parsed = toNumber(value);
      return parsed === null ? "" : `${parsed} / ${field.max ?? 5}`;
    }
    case "gps": {
      if (!value || typeof value !== "object") return "";
      const distance = (value as Record<string, unknown>).distanceFromSiteM;
      return typeof distance === "number" ? `Checked in ${distance} m from the pin` : "Checked in";
    }
    case "currency": {
      const parsed = toNumber(value);
      return parsed === null ? displayValue(value) : `${field.unit ?? "₹"} ${parsed.toLocaleString("en-IN")}`;
    }
    case "number":
    case "calculated": {
      const parsed = toNumber(value);
      if (parsed === null) return displayValue(value);
      const shown = parsed.toLocaleString("en-IN");
      return field.unit ? `${shown} ${field.unit}` : shown;
    }
    default:
      return displayValue(value);
  }
}

/* ------------------------------------------------------------------ */
/* Record state and lifecycle                                          */
/* ------------------------------------------------------------------ */

export function readFieldState(data: Record<string, unknown>): FieldState {
  const raw = data.__field;
  const state = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sections =
    state.sections && typeof state.sections === "object" && !Array.isArray(state.sections)
      ? (state.sections as FieldState["sections"])
      : {};
  return {
    stage: typeof state.stage === "string" && state.stage ? state.stage : "new",
    stageChangedAt: typeof state.stageChangedAt === "string" ? state.stageChangedAt : null,
    sections,
    lastVisitAt: typeof state.lastVisitAt === "string" ? state.lastVisitAt : null,
    lastVisitBy: typeof state.lastVisitBy === "string" ? state.lastVisitBy : null,
    followUpAt: typeof state.followUpAt === "string" ? state.followUpAt : null,
    mutations: Array.isArray(state.mutations)
      ? state.mutations.filter((item): item is string => typeof item === "string")
      : [],
    assignee: assigneeOf(state.assignee),
  };
}

function assigneeOf(value: unknown): FieldState["assignee"] {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const userId = Number(item.userId);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return {
    userId,
    name: typeof item.name === "string" && item.name ? item.name : `Employee ${userId}`,
  };
}

export function stageOf(config: Pick<FieldAppConfig, "stages">, stageKey: string): FieldStage {
  return (
    config.stages.find((stage) => stage.key === stageKey) ??
    config.stages.find((stage) => stage.key === "new") ??
    DEFAULT_STAGES[0]
  );
}

/**
 * Lifecycle rule:
 *   1. A matching stageWhen rule always wins (e.g. "Not construction" closes).
 *   2. Otherwise setsStage only moves an open record FORWARD.
 *   3. A closed (but not terminal) record re-opens when worked on again.
 *   4. A terminal record (Order) is only moved by an explicit rule.
 */
export function nextStage(
  config: Pick<FieldAppConfig, "stages">,
  current: string,
  section: FieldSection,
  values: Record<string, unknown>,
): string {
  for (const rule of section.stageWhen) {
    const matches = answerTokens(values[rule.field])
      .map((token) => token.toLowerCase())
      .includes(rule.equals.toLowerCase());
    if (matches && config.stages.some((stage) => stage.key === rule.stage)) {
      return rule.stage;
    }
  }

  const target = section.setsStage;
  if (!target || !config.stages.some((stage) => stage.key === target)) {
    return current;
  }

  const currentStage = stageOf(config, current);
  if (currentStage.terminal) return current;
  if (currentStage.closed) return target;

  const rank = (stageKey: string) => config.stages.findIndex((stage) => stage.key === stageKey);
  return rank(target) > rank(current) ? target : current;
}

export function pointFrom(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== "object") return null;
  const point = value as Record<string, unknown>;
  const lat = toNumber(point.lat);
  const lng = toNumber(point.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const radius = 6_371_000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const point = pointFrom(value);
    if (point) return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
    return "";
  }
  return String(value);
}
