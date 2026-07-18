const HUMAN_TEXT_FIELDS = [
  'title', 'recordingTitle', 'albumTitle', 'creator', 'albumArtist', 'label', 'notes', 'albumNotes'
] as const;

const HUMAN_TEXT_ARRAY_FIELDS = ['tags', 'albumTags', 'genres', 'styles'] as const;

/**
 * Repairs signatures found in legacy iTunes-era tags without treating every
 * legitimate tilde or ring as damage. The broken glyph is an artificial
 * uppercase character inside a word; normal NFD text such as Sen\u0303or or
 * A\u030Angstro\u0308m remains semantically unchanged and is only normalized.
 */
export function repairLegacyDiacritics(value: string): string {
  return value
    .replace(/(\p{L})(?:N\u0303|Ñ)(?=\p{Ll})/gu, '$1ä')
    .replace(/(\p{L})(?:A\u030a|Å)(?=\p{Ll})/gu, '$1ü')
    .normalize('NFC');
}

export function repairCatalogMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const repaired = structuredClone(metadata);
  for (const field of HUMAN_TEXT_FIELDS) {
    if (typeof repaired[field] === 'string') repaired[field] = repairLegacyDiacritics(repaired[field]);
  }
  for (const field of HUMAN_TEXT_ARRAY_FIELDS) {
    if (Array.isArray(repaired[field])) {
      repaired[field] = repaired[field].map((value) => typeof value === 'string' ? repairLegacyDiacritics(value) : value);
    }
  }
  if (Array.isArray(repaired.roles)) {
    repaired.roles = repaired.roles.map((role) => {
      if (!role || typeof role !== 'object' || Array.isArray(role)) return role;
      const next = { ...role } as Record<string, unknown>;
      if (typeof next.name === 'string') next.name = repairLegacyDiacritics(next.name);
      if (typeof next.role === 'string') next.role = repairLegacyDiacritics(next.role);
      return next;
    });
  }
  return repaired;
}
