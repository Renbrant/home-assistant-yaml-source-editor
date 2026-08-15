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

export function filterTemplateBlocks(index, query) {
  const blocks = Array.isArray(index?.blocks) ? index.blocks : [];
  const tokens = normalizeTemplateSearchTokens(query);

  if (tokens.length === 0) {
    return blocks;
  }

  return blocks.flatMap((block) => {
    const entities = Array.isArray(block?.entities)
      ? block.entities
      : [];

    const blockText = templateSearchText(
      block?.label,
      block?.section
    );

    const blockMatches = tokens.every((token) =>
      blockText.includes(token)
    );

    if (blockMatches) {
      return [
        {
          ...block,
          entities,
        },
      ];
    }

    const matchingEntities = entities.filter((entity) => {
      const entityText = templateSearchText(
        block?.label,
        block?.section,
        entity?.name,
        entity?.unique_id
      );

      return tokens.every((token) =>
        entityText.includes(token)
      );
    });

    if (matchingEntities.length === 0) {
      return [];
    }

    return [
      {
        ...block,
        entities: matchingEntities,
      },
    ];
  });
}

function normalizeTemplateSearchTokens(query) {
  return String(query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function templateSearchText(...values) {
  return values
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
}
