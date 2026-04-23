/**
 * Format an SSE event frame. Pairs with {@link parseSseStream}.
 *
 * Multi-line `data` is split across multiple `data:` lines per the SSE spec —
 * each embedded `\n` becomes its own line, and the parser rejoins them.
 *
 * The returned string includes a trailing blank line (the dispatch marker).
 */
export function formatSseEvent(event: string, data: string, id?: string): string {
  const lines: string[] = [];
  if(id !== undefined) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  for(const part of data.split('\n')) lines.push(`data: ${part}`);
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

/** SSE comment frame (server keepalive). Lines starting with `:` are ignored by compliant parsers. */
export function formatSseComment(comment: string): string {
  const safe = comment.replace(/\n/g, ' ');
  return `: ${safe}\n\n`;
}
