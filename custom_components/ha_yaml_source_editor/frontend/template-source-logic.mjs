export function findTemplateBlock(index, blockId) {
  const blocks = Array.isArray(index?.blocks) ? index.blocks : [];
  return blocks.find((block) => block?.block_id === blockId) ?? null;
}

export function findTemplateEntity(block, entityId) {
  const entities = Array.isArray(block?.entities) ? block.entities : [];
  return entities.find((entity) => entity?.entity_id === entityId) ?? null;
}

export function templateBlockDocumentId(result) {
  const sha256 = result?.source?.sha256;
  const blockId = result?.block?.block_id;

  if (!sha256 || !blockId) {
    return null;
  }

  return `template:${sha256}:${blockId}`;
}

export function templateEntityLocalLine(block, entityId) {
  const entity = findTemplateEntity(block, entityId);

  if (
    !entity ||
    !Number.isFinite(entity.start_line) ||
    !Number.isFinite(block?.start_line)
  ) {
    return null;
  }

  return Math.max(1, entity.start_line - block.start_line + 1);
}
