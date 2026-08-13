export const DEFAULT_DIFF_LIMIT = 500;
export const DEFAULT_VALUE_LIMIT = 1000;

export function diffSemantic(sourceValue, haValue, { limit = DEFAULT_DIFF_LIMIT } = {}) {
  assertJsonValue(sourceValue, "source");
  assertJsonValue(haValue, "ha");

  const entries = [];
  const state = {
    limit,
    truncated: false,
    totalDifferences: 0,
  };

  compareValues(sourceValue, haValue, "$", entries, state);

  return {
    entries,
    truncated: state.truncated,
    totalDifferences: state.totalDifferences,
    omittedDifferences: Math.max(0, state.totalDifferences - entries.length),
  };
}

export function analyzeThreeWay({ baselineValue, sourceValue, haValue, limit }) {
  return {
    sourceChanges: diffSemantic(baselineValue, sourceValue, { limit }),
    haChanges: diffSemantic(baselineValue, haValue, { limit }),
    currentDifference: diffSemantic(sourceValue, haValue, { limit }),
  };
}

export function serializeDiffValue(value, { limit = DEFAULT_VALUE_LIMIT } = {}) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= limit) {
    return { text: serialized, truncated: false };
  }

  return {
    text: `${serialized.slice(0, limit)}...`,
    truncated: true,
  };
}

export function formatDiffKindForLabels(kind, { sourceLabel, haLabel } = {}) {
  if (kind === "changed") {
    return "CHANGED";
  }

  const directSourceToHa =
    sourceLabel === "Saved Source" && haLabel === "Current HA";

  if (kind === "source_only") {
    return directSourceToHa ? "SOURCE ONLY" : "REMOVED";
  }

  if (kind === "ha_only") {
    return directSourceToHa ? "HA ONLY" : "ADDED";
  }

  return "CHANGED";
}

function compareValues(sourceValue, haValue, path, entries, state) {
  if (Object.is(sourceValue, haValue)) {
    return;
  }

  if (Array.isArray(sourceValue) && Array.isArray(haValue)) {
    compareArrays(sourceValue, haValue, path, entries, state);
    return;
  }

  if (isPlainObject(sourceValue) && isPlainObject(haValue)) {
    compareObjects(sourceValue, haValue, path, entries, state);
    return;
  }

  addDiff(
    entries,
    state,
    {
      path,
      kind: "changed",
      sourceValue,
      haValue,
    },
  );
}

function compareObjects(sourceValue, haValue, path, entries, state) {
  const keys = new Set([...Object.keys(sourceValue), ...Object.keys(haValue)]);
  for (const key of Array.from(keys).sort()) {
    const childPath = joinPath(path, key);
    const sourceHasKey = Object.hasOwn(sourceValue, key);
    const haHasKey = Object.hasOwn(haValue, key);

    if (!haHasKey) {
      addDiff(entries, state, {
        path: childPath,
        kind: "source_only",
        sourceValue: sourceValue[key],
      });
      continue;
    }

    if (!sourceHasKey) {
      addDiff(entries, state, {
        path: childPath,
        kind: "ha_only",
        haValue: haValue[key],
      });
      continue;
    }

    compareValues(sourceValue[key], haValue[key], childPath, entries, state);
  }
}

function compareArrays(sourceValue, haValue, path, entries, state) {
  const maxLength = Math.max(sourceValue.length, haValue.length);
  for (let index = 0; index < maxLength; index += 1) {
    const childPath = `${path}[${index}]`;
    const sourceHasIndex = index < sourceValue.length;
    const haHasIndex = index < haValue.length;

    if (!haHasIndex) {
      addDiff(entries, state, {
        path: childPath,
        kind: "source_only",
        sourceValue: sourceValue[index],
      });
      continue;
    }

    if (!sourceHasIndex) {
      addDiff(entries, state, {
        path: childPath,
        kind: "ha_only",
        haValue: haValue[index],
      });
      continue;
    }

    compareValues(sourceValue[index], haValue[index], childPath, entries, state);
  }
}

function addDiff(entries, state, entry) {
  state.totalDifferences += 1;
  if (entries.length < state.limit) {
    entries.push(entry);
    return;
  }

  state.truncated = true;
}

function assertJsonValue(value, label, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} contains a non-finite number.`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new TypeError(`${label} contains a non-JSON value.`);
  }

  if (seen.has(value)) {
    throw new TypeError(`${label} contains circular data.`);
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonValue(item, label, seen);
    }
    seen.delete(value);
    return;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} contains a non-JSON object.`);
  }

  for (const item of Object.values(value)) {
    assertJsonValue(item, label, seen);
  }
  seen.delete(value);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function joinPath(path, key) {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return `${path}.${key}`;
  }

  return `${path}[${JSON.stringify(key)}]`;
}
