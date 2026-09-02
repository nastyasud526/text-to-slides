import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const STAGES = [
  "initialized",
  "source_ready",
  "plan_ready",
  "assets_ready",
  "presentation_built",
  "verified"
];

const STAGE_STATUSES = new Set(["pending", "in_progress", "complete", "waiting_for_input", "failed"]);

function fail(message) {
  throw new Error(message);
}

function required(values, name) {
  const value = values[name];
  if (typeof value !== "string" || !value.trim()) fail(`Missing required option --${name.replaceAll("_", "-")}`);
  return value.trim();
}

function safeItemId(value) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) fail(`Unsafe item id ${JSON.stringify(value)}; use letters, digits, dot, underscore, or hyphen`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function localTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const part = (name) => parts.find((entry) => entry.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}_${part("hour")}-${part("minute")}-${part("second")}`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error.code)) throw error;
    await fs.copyFile(temporary, filePath);
    await fs.unlink(temporary);
  }
}

function parseLegacyYaml(text) {
  const value = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_]+):\s*(.*?)\s*$/.exec(line);
    if (match) value[match[1]] = match[2];
  }
  return value;
}

async function readManifest(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    return parseLegacyYaml(text);
  }
}

function legacyScopeKey(manifest) {
  if (manifest.scope?.key) return manifest.scope.key;
  if (manifest.scope_key) return manifest.scope_key;
  const requested = String(manifest.requested ?? "");
  const lesson = /урок\s+(\d+[.,]\d+)/i.exec(requested);
  if (lesson) return `lesson-${lesson[1].replace(",", ".")}`;
  return requested.trim().toLowerCase();
}

async function fingerprints(values) {
  const result = {};
  for (const name of ["source", "template", "catalog"]) {
    const filePath = values[name];
    if (!filePath) continue;
    const absolute = path.resolve(filePath);
    const bytes = await fs.readFile(absolute);
    result[name] = {
      path: absolute,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  }
  return result;
}

async function findRuns(resultsPath, courseId, scopeKey) {
  const results = path.resolve(resultsPath);
  if (!(await exists(results))) return [];
  const matches = [];
  for (const entry of await fs.readdir(results, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runRoot = path.join(results, entry.name);
    const manifestPath = path.join(runRoot, "_work", "run.yaml");
    if (!(await exists(manifestPath))) continue;
    let manifest;
    try {
      manifest = await readManifest(manifestPath);
    } catch {
      continue;
    }
    const manifestCourse = manifest.course?.id ?? manifest.course_id;
    if (manifestCourse !== courseId || legacyScopeKey(manifest) !== scopeKey) continue;
    matches.push({
      runRoot,
      manifestPath,
      createdAt: manifest.created_at ?? entry.name,
      status: manifest.status ?? "unknown",
      currentStage: manifest.current_stage ?? null,
      scopeLabel: manifest.scope?.label ?? manifest.requested ?? scopeKey,
      fingerprints: manifest.fingerprints ?? null
    });
  }
  return matches.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

async function start(values) {
  const results = path.resolve(required(values, "results"));
  const courseId = required(values, "course_id");
  const courseRoot = path.resolve(required(values, "course_root"));
  const scopeKey = required(values, "scope_key");
  const scopeLabel = required(values, "scope_label");
  const itemIds = required(values, "items").split(",").map((item) => safeItemId(item.trim())).filter(Boolean);
  if (!itemIds.length) fail("--items must contain at least one item id");

  const previous = await findRuns(results, courseId, scopeKey);
  if (previous.length && !values.fresh) {
    console.log(JSON.stringify({ requiresUserChoice: true, matches: previous }, null, 2));
    return;
  }

  const runId = values.timestamp ? safeItemId(values.timestamp) : localTimestamp();
  const runRoot = path.join(results, runId);
  if (await exists(runRoot)) fail(`Run directory already exists: ${runRoot}`);

  const workRoot = path.join(runRoot, "_work");
  await fs.mkdir(path.join(runRoot, "presentations"), { recursive: true });
  await fs.mkdir(path.join(workRoot, "reports"), { recursive: true });

  const createdAt = nowIso();
  for (const itemId of itemIds) {
    const itemRoot = path.join(workRoot, "items", itemId);
    await fs.mkdir(path.join(itemRoot, "generated-assets"), { recursive: true });
    await fs.mkdir(path.join(itemRoot, "verification"), { recursive: true });
    await atomicWriteJson(path.join(itemRoot, "state.yaml"), {
      version: 1,
      item_id: itemId,
      status: "active",
      current_stage: "initialized",
      stages: Object.fromEntries(STAGES.map((stage) => [stage, {
        status: stage === "initialized" ? "complete" : "pending",
        updated_at: createdAt
      }])),
      updated_at: createdAt
    });
  }

  const manifest = {
    version: 1,
    run_id: runId,
    course: { id: courseId, root: courseRoot },
    scope: { key: scopeKey, label: scopeLabel, items: itemIds },
    status: "active",
    current_stage: "initialized",
    fingerprints: await fingerprints(values),
    created_at: createdAt,
    updated_at: createdAt
  };
  await atomicWriteJson(path.join(workRoot, "run.yaml"), manifest);
  console.log(JSON.stringify({ created: true, runRoot, manifest }, null, 2));
}

async function setStage(values) {
  const runRoot = path.resolve(required(values, "run"));
  const itemId = safeItemId(required(values, "item"));
  const stage = required(values, "stage");
  const status = required(values, "status");
  if (!STAGES.includes(stage)) fail(`Unknown stage ${JSON.stringify(stage)}`);
  if (!STAGE_STATUSES.has(status)) fail(`Unknown stage status ${JSON.stringify(status)}`);

  const statePath = path.join(runRoot, "_work", "items", itemId, "state.yaml");
  if (!(await exists(statePath))) fail(`Item state does not exist: ${statePath}`);
  const state = await readManifest(statePath);
  const index = STAGES.indexOf(stage);
  if (status === "in_progress" && index > 0 && state.stages?.[STAGES[index - 1]]?.status !== "complete") {
    fail(`Cannot start ${stage}; previous stage ${STAGES[index - 1]} is not complete`);
  }

  const updatedAt = nowIso();
  state.stages ??= {};
  state.stages[stage] = {
    ...(state.stages[stage] ?? {}),
    status,
    updated_at: updatedAt
  };
  if (values.message) state.stages[stage].message = values.message;
  if (values.outputs) state.stages[stage].outputs = values.outputs.split(",").map((item) => path.resolve(item.trim()));
  state.current_stage = stage;
  state.status = status === "waiting_for_input" || status === "failed" ? status : "active";
  if (stage === "verified" && status === "complete") state.status = "complete";
  state.updated_at = updatedAt;
  await atomicWriteJson(statePath, state);

  const runManifestPath = path.join(runRoot, "_work", "run.yaml");
  const runManifest = await readManifest(runManifestPath);
  runManifest.current_stage = stage;
  runManifest.status = state.status === "complete" ? runManifest.status : state.status;
  runManifest.updated_at = updatedAt;
  await atomicWriteJson(runManifestPath, runManifest);
  console.log(JSON.stringify({ updated: true, statePath, state }, null, 2));
}

async function finish(values) {
  const runRoot = path.resolve(required(values, "run"));
  const manifestPath = path.join(runRoot, "_work", "run.yaml");
  const manifest = await readManifest(manifestPath);
  for (const itemId of manifest.scope?.items ?? []) {
    const state = await readManifest(path.join(runRoot, "_work", "items", itemId, "state.yaml"));
    if (state.stages?.verified?.status !== "complete") fail(`Cannot finish run; item ${itemId} is not verified`);
  }
  manifest.status = "complete";
  manifest.current_stage = "complete";
  manifest.updated_at = nowIso();
  await atomicWriteJson(manifestPath, manifest);
  console.log(JSON.stringify({ complete: true, runRoot, manifest }, null, 2));
}

const command = process.argv[2];
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: {
    results: { type: "string" },
    course_id: { type: "string" },
    course_root: { type: "string" },
    scope_key: { type: "string" },
    scope_label: { type: "string" },
    items: { type: "string" },
    source: { type: "string" },
    template: { type: "string" },
    catalog: { type: "string" },
    fresh: { type: "boolean", default: false },
    timestamp: { type: "string" },
    run: { type: "string" },
    item: { type: "string" },
    stage: { type: "string" },
    status: { type: "string" },
    message: { type: "string" },
    outputs: { type: "string" }
  },
  allowPositionals: false
});

if (command === "find") {
  console.log(JSON.stringify({
    matches: await findRuns(
      required(values, "results"),
      required(values, "course_id"),
      required(values, "scope_key")
    )
  }, null, 2));
} else if (command === "start") {
  await start(values);
} else if (command === "set-stage") {
  await setStage(values);
} else if (command === "finish") {
  await finish(values);
} else {
  fail("Usage: run_state.mjs <find|start|set-stage|finish> [options]");
}
