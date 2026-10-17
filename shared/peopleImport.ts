/**
 * CSV people import (PPL-04): the craft rule shared by the API handler and DemoTransport, so demo and live behave
 * identically (QA-005). A craft in an import row may be given as its id (what `parsePeopleCsv` sends) or as its
 * short code in any case (what a hand-written request may send). It is valid only when it names a craft in the
 * organisation's catalogue; there is no length rule, because craft ids are catalogue data, not codes.
 */
export interface CraftRef { id: string; short: string }

/** The catalogue id the value names, or null when the organisation has no such craft. */
export function resolveCraftRef(crafts: readonly CraftRef[], value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const byId = crafts.find((c) => c.id === v);
  if (byId) return byId.id;
  const upper = v.toUpperCase();
  return crafts.find((c) => c.short.toUpperCase() === upper)?.id ?? null;
}

/** The message both implementations report for a craft that is not in the catalogue. */
export function unknownCraftMessage(value: string): string {
  return `Unknown craft '${value}'`;
}
