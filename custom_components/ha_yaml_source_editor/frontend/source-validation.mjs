import { load, YAML11_SCHEMA } from "./vendor/js-yaml.mjs";

const PARSE_OPTIONS = {
  schema: YAML11_SCHEMA,
  maxDepth: 100,
  maxAliases: 1000,
  maxTotalMergeKeys: 10000,
};

export function validateSourceText(sourceText) {
  return analyzeSourceText(sourceText).validation;
}

export function analyzeSourceText(sourceText) {
  if (sourceText.length === 0) {
    return analysis(invalid("yaml", "Source YAML is empty."));
  }

  let parsed;

  try {
    parsed = load(sourceText, PARSE_OPTIONS);
  } catch (err) {
    return analysis(syntaxErrorResult(err));
  }

  if (parsed == null) {
    return analysis(invalid("yaml", "Source YAML is empty."));
  }

  const wireResult = validateWireCompatible(parsed);
  if (!wireResult.valid) {
    return analysis(wireResult);
  }

  const structureResult = validateLovelaceStructure(parsed);
  if (!structureResult.valid) {
    return analysis(structureResult);
  }

  return {
    validation: {
      valid: true,
      stage: "ok",
      message: "Source YAML is valid.",
      details: [
        { stage: "yaml", message: "OK" },
        { stage: "wire", message: "OK" },
        { stage: "lovelace", message: "OK" },
      ],
      summary: structureResult.summary,
    },
    parsedConfig: parsed,
  };
}

export function validateWireCompatible(value) {
  return validateWireValue(value, "$", []);
}

function validateWireValue(value, path, stack) {
  if (value == null || typeof value === "string" || typeof value === "boolean") {
    return ok();
  }

  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return ok();
    }

    return invalid(
      "wire",
      `${path} resolves to a non-finite number and cannot be sent through the Lovelace WebSocket API.`,
      { path },
    );
  }

  if (typeof value === "bigint") {
    return invalid("wire", `${path} resolves to a BigInt, which is not JSON/WebSocket compatible.`, { path });
  }

  if (typeof value === "undefined") {
    return invalid("wire", `${path} resolves to undefined, which is not JSON/WebSocket compatible.`, { path });
  }

  if (typeof value === "symbol") {
    return invalid("wire", `${path} resolves to a Symbol, which is not JSON/WebSocket compatible.`, { path });
  }

  if (typeof value === "function") {
    return invalid("wire", `${path} resolves to a function, which is not JSON/WebSocket compatible.`, { path });
  }

  if (stack.includes(value)) {
    return invalid("wire", `${path} contains a circular reference, which cannot be sent through the Lovelace WebSocket API.`, { path });
  }

  if (value instanceof Date) {
    return invalid(
      "wire",
      `${path} resolves to a Date and cannot be deployed losslessly through the Lovelace WebSocket API. Quote it to keep it a string.`,
      { path },
    );
  }

  if (value instanceof Set) {
    return invalid("wire", `${path} resolves to a Set, which is not JSON/WebSocket compatible.`, { path });
  }

  if (value instanceof Map) {
    return invalid("wire", `${path} resolves to a Map, which is not JSON/WebSocket compatible.`, { path });
  }

  if (ArrayBuffer.isView(value)) {
    return invalid("wire", `${path} resolves to binary or typed-array data, which is not JSON/WebSocket compatible.`, { path });
  }

  if (value instanceof RegExp) {
    return invalid("wire", `${path} resolves to a RegExp, which is not JSON/WebSocket compatible.`, { path });
  }

  const nextStack = [...stack, value];

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const itemResult = validateWireValue(value[index], `${path}[${index}]`, nextStack);
      if (!itemResult.valid) {
        return itemResult;
      }
    }

    return ok();
  }

  if (!isPlainObject(value)) {
    return invalid(
      "wire",
      `${path} resolves to a non-plain object (${objectType(value)}), which is not JSON/WebSocket compatible.`,
      { path },
    );
  }

  for (const [key, item] of Object.entries(value)) {
    const itemResult = validateWireValue(item, `${path}${propertyPath(key)}`, nextStack);
    if (!itemResult.valid) {
      return itemResult;
    }
  }

  return ok();
}

export function validateLovelaceStructure(config) {
  if (!isPlainObject(config)) {
    return invalid("lovelace", "Lovelace dashboard source must be a plain object.");
  }

  const hasViews = Object.hasOwn(config, "views");
  const hasStrategy = Object.hasOwn(config, "strategy");

  if (!hasViews && !hasStrategy) {
    return invalid(
      "lovelace",
      "Lovelace dashboard source must contain either a views array or a strategy object.",
    );
  }

  if (hasViews) {
    if (!Array.isArray(config.views)) {
      return invalid("lovelace", "$.views must be an array.", { path: "$.views" });
    }

    for (let index = 0; index < config.views.length; index += 1) {
      if (!isPlainObject(config.views[index])) {
        return invalid("lovelace", `$.views[${index}] must be a plain object.`, {
          path: `$.views[${index}]`,
        });
      }
    }
  }

  if (hasStrategy) {
    if (!isPlainObject(config.strategy)) {
      return invalid("lovelace", "$.strategy must be a plain object.", {
        path: "$.strategy",
      });
    }

    if (
      Object.hasOwn(config.strategy, "type") &&
      (typeof config.strategy.type !== "string" ||
        config.strategy.type.length === 0)
    ) {
      return invalid("lovelace", "$.strategy.type must be a non-empty string.", {
        path: "$.strategy.type",
      });
    }
  }

  return {
    valid: true,
    summary: {
      views: hasViews ? config.views.length : null,
      strategy: hasStrategy,
    },
  };
}

function syntaxErrorResult(err) {
  const mark = err?.mark;
  const line = typeof mark?.line === "number" ? mark.line + 1 : undefined;
  const column =
    typeof mark?.column === "number" ? mark.column + 1 : undefined;

  return invalid("yaml", err?.reason || err?.message || "Invalid YAML.", {
    line,
    column,
  });
}

function invalid(stage, message, extra = {}) {
  return {
    valid: false,
    stage,
    message,
    ...extra,
  };
}

function analysis(validation) {
  return {
    validation,
    parsedConfig: null,
  };
}

function ok() {
  return { valid: true };
}

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectType(value) {
  return Object.prototype.toString.call(value).slice(8, -1);
}

function propertyPath(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
