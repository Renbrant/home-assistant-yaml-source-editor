export const DEPLOYMENT_OPERATION = {
  IDLE: "Idle",
  PREFLIGHT: "Preflight",
  AWAITING_CONFIRMATION: "Awaiting confirmation",
  DEPLOYING: "Deploying",
  VERIFYING: "Verifying",
  RECORDING_BASELINE: "Recording baseline",
  SUCCESS: "Success",
  CONFLICT: "Conflict",
  ERROR: "Error",
};

export function assessDeploymentPreflight({
  sourceValid,
  hasUnsavedChanges,
  savedSourceText,
  backendSourceText,
  deploymentBaseline,
  preflightHaSemanticHash,
}) {
  if (hasUnsavedChanges) {
    return block("Save Source before deploying.", "unsaved_source");
  }

  if (savedSourceText.length === 0) {
    return block("Saved Source is empty.", "empty_source");
  }

  if (backendSourceText !== savedSourceText) {
    return block(
      "The backend Source Document changed. Reload or reselect the Source Document.",
      "source_changed",
    );
  }

  if (!sourceValid) {
    return block(
      "Saved Source is invalid. Use Validate for details before deploying.",
      "invalid_source",
    );
  }

  if (
    deploymentBaseline &&
    preflightHaSemanticHash !== deploymentBaseline.ha_semantic_hash
  ) {
    return block(
      "Home Assistant changed outside the deployment baseline. Conflict resolution is not available in M6.",
      "ha_conflict",
    );
  }

  return {
    allowed: true,
    firstDeployment: deploymentBaseline == null,
  };
}

export function verifyFinalHaRead({
  deploymentBaseline,
  initialPreflightHaHash,
  latestHaHash,
}) {
  if (latestHaHash !== initialPreflightHaHash) {
    return block(
      "The Home Assistant dashboard changed during deployment preparation. Nothing was deployed. Refresh status and try again.",
      "ha_changed_during_preflight",
    );
  }

  if (deploymentBaseline && latestHaHash !== deploymentBaseline.ha_semantic_hash) {
    return block(
      "Home Assistant changed outside the deployment baseline. Deployment was blocked.",
      "ha_conflict",
    );
  }

  return { allowed: true };
}

export function verifyPostSave({
  verifiedHaSemanticHash,
  deploymentSourceSemanticHash,
}) {
  if (verifiedHaSemanticHash !== deploymentSourceSemanticHash) {
    return block(
      "Home Assistant accepted the save request, but the resulting dashboard does not match the Source configuration. The deployment baseline was not updated.",
      "verification_mismatch",
    );
  }

  return { verified: true };
}

function block(message, reason) {
  return {
    allowed: false,
    verified: false,
    reason,
    message,
  };
}
