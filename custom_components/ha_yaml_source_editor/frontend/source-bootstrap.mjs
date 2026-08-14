export function isBlankSourceText(sourceText) {
  return String(sourceText ?? "").trim().length === 0;
}
