export const DEPLOYMENT_STATUS = {
  NOT_DEPLOYED: "NOT DEPLOYED",
  IN_SYNC: "IN SYNC",
  SOURCE_MODIFIED: "SOURCE MODIFIED",
  HA_MODIFIED: "HA MODIFIED",
  BOTH_MODIFIED: "BOTH MODIFIED",
  SYNC_ERROR: "SYNC ERROR",
};

export const SOURCE_VS_HA = {
  MATCH: "MATCH",
  DIFFERENT: "DIFFERENT",
  UNAVAILABLE: "UNAVAILABLE",
};

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value, []));
}

export function compareSourceToHa(sourceSemanticHash, haSemanticHash) {
  if (!sourceSemanticHash || !haSemanticHash) {
    return SOURCE_VS_HA.UNAVAILABLE;
  }

  return sourceSemanticHash === haSemanticHash
    ? SOURCE_VS_HA.MATCH
    : SOURCE_VS_HA.DIFFERENT;
}

export function classifySyncState({
  deploymentBaseline,
  currentSourceTextHash,
  currentSourceSemanticHash,
  currentHaSemanticHash,
  sourceValid,
}) {
  if (!deploymentBaseline) {
    return {
      status: DEPLOYMENT_STATUS.NOT_DEPLOYED,
      note: null,
    };
  }

  if (!currentSourceTextHash || !currentHaSemanticHash) {
    return {
      status: DEPLOYMENT_STATUS.SYNC_ERROR,
      note: "Required hashes are unavailable.",
    };
  }

  const sourceChanged =
    currentSourceTextHash !== deploymentBaseline.source_text_hash;
  const haChanged = currentHaSemanticHash !== deploymentBaseline.ha_semantic_hash;
  let status = DEPLOYMENT_STATUS.IN_SYNC;

  if (sourceChanged && haChanged) {
    status = DEPLOYMENT_STATUS.BOTH_MODIFIED;
  } else if (sourceChanged) {
    status = DEPLOYMENT_STATUS.SOURCE_MODIFIED;
  } else if (haChanged) {
    status = DEPLOYMENT_STATUS.HA_MODIFIED;
  }

  let note = null;
  if (
    sourceChanged &&
    currentSourceSemanticHash &&
    currentSourceSemanticHash === deploymentBaseline.source_semantic_hash
  ) {
    note = "Source text changed; dashboard semantics are unchanged.";
  } else if (sourceValid === false) {
    note = "Current Source YAML is invalid.";
  }

  return { status, note };
}

export function shortHash(hash) {
  return hash ? hash.slice(0, 12) : "Unavailable";
}

function canonicalize(value, stack) {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Cannot canonicalize non-finite number data.");
    }
    return value;
  }

  if (typeof value === "bigint" || typeof value === "undefined") {
    throw new TypeError("Cannot canonicalize non-JSON data.");
  }

  if (stack.includes(value)) {
    throw new TypeError("Cannot canonicalize circular data.");
  }

  const nextStack = [...stack, value];

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, nextStack));
  }

  if (!isPlainObject(value)) {
    throw new TypeError("Cannot canonicalize non-plain object data.");
  }

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key], nextStack);
      return result;
    }, {});
}

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
