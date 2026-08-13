export function assessOverwritePreflight({
  compareSnapshot,
  hasUnsavedChanges,
  freshDocumentUpdatedAt,
  currentSourceTextHash,
  currentSourceSemanticHash,
  currentHaSemanticHash,
  syncStatus,
}) {
  if (!compareSnapshot) {
    return block("Run Compare Source vs HA before resolving this conflict.", "missing_compare");
  }

  if (hasUnsavedChanges) {
    return block("Save Source before resolving conflicts.", "unsaved_source");
  }

  if (!["HA MODIFIED", "BOTH MODIFIED"].includes(syncStatus)) {
    return block("Overwrite HA is only available for HA MODIFIED or BOTH MODIFIED conflicts.", "not_applicable");
  }

  if (freshDocumentUpdatedAt !== compareSnapshot.documentUpdatedAt) {
    return block("Source changed since comparison. Compare again.", "source_changed");
  }

  if (
    currentSourceTextHash !== compareSnapshot.sourceTextHash ||
    currentSourceSemanticHash !== compareSnapshot.sourceSemanticHash
  ) {
    return block("Source changed since comparison. Compare again.", "source_changed");
  }

  if (currentHaSemanticHash !== compareSnapshot.haSemanticHash) {
    return block("Home Assistant changed since comparison. Compare again.", "ha_changed");
  }

  return { allowed: true };
}

export function assessFinalOverwriteRead({
  latestHaSemanticHash,
  preconfirmationHaSemanticHash,
  compareSnapshot,
}) {
  if (
    latestHaSemanticHash !== compareSnapshot.haSemanticHash ||
    latestHaSemanticHash !== preconfirmationHaSemanticHash
  ) {
    return block(
      "Home Assistant changed during conflict resolution. Nothing was deployed. Compare again.",
      "ha_changed_during_confirmation",
    );
  }

  return { allowed: true };
}

function block(message, reason) {
  return {
    allowed: false,
    reason,
    message,
  };
}
