/**
 * Pure @mention utility functions — usable in both the component and unit tests
 * without triggering Angular JIT compilation.
 */

/** Filter a roster of usernames by a @mention prefix (up to 8 results). */
export function filterMentionSuggestions(roster: string[], query: string): string[] {
  if (!query && query !== '') return [];
  const lower = query.toLowerCase();
  return roster.filter(u => u.toLowerCase().startsWith(lower)).slice(0, 8);
}

/**
 * Strip @handles not present in the roster; return cleaned body and list of
 * removed handles.
 */
export function stripUnknownMentions(
  body: string,
  roster: string[],
): { body: string; unknownMentions: string[] } {
  const unknown: string[] = [];
  const cleaned = body.replace(/@(\w+)/g, (match, name: string) => {
    if (roster.includes(name)) return match;
    unknown.push(`@${name}`);
    return name;
  });
  return { body: cleaned, unknownMentions: unknown };
}
