/**
 * Helpers for 1.5–2h meetings: chunk long transcripts so LLM calls stay in-context.
 */

export function longMeetingChunkChars(): number {
  return Math.max(4000, Number(process.env.LONG_MEETING_CHUNK_CHARS ?? 10000));
}

export function longMeetingMaxScreenshotFrames(): number {
  return Math.max(6, Number(process.env.SCREENSHOT_MAX_FRAMES ?? 18));
}

export function longMeetingMinScreenshotIntervalSec(): number {
  return Math.max(15, Number(process.env.SCREENSHOT_INTERVAL_SEC ?? 60));
}

/** Split plain text into overlapping windows. */
export function chunkText(
  text: string,
  maxChars = longMeetingChunkChars(),
  overlap = 400,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(trimmed.length, start + maxChars);
    if (end < trimmed.length) {
      // Prefer breaking on a newline near the end of the window.
      const window = trimmed.slice(start, end);
      const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'));
      if (breakAt > maxChars * 0.5) {
        end = start + breakAt;
      }
    }
    chunks.push(trimmed.slice(start, end).trim());
    if (end >= trimmed.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

export type TimedLine = { startMs: number; endMs: number; text: string };

/** Group timed transcript lines into chunks under maxChars. */
export function chunkTimedLines(
  lines: TimedLine[],
  maxChars = longMeetingChunkChars(),
): Array<{ text: string; startMs: number; endMs: number }> {
  if (!lines.length) return [];

  const chunks: Array<{ text: string; startMs: number; endMs: number; parts: string[] }> =
    [];
  let current: { text: string; startMs: number; endMs: number; parts: string[] } | null =
    null;

  for (const line of lines) {
    const nextLen = (current?.text.length ?? 0) + line.text.length + 1;
    if (!current || nextLen > maxChars) {
      if (current) chunks.push(current);
      current = {
        parts: [line.text],
        text: line.text,
        startMs: line.startMs,
        endMs: line.endMs,
      };
    } else {
      current.parts.push(line.text);
      current.text = current.parts.join('\n');
      current.endMs = line.endMs;
    }
  }
  if (current) chunks.push(current);

  return chunks.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }));
}

/** Deduplicate list items (case-insensitive, light normalize). */
export function dedupeStrings(items: string[], max = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const text = raw.trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

export function parseJsonItems(raw: string): string[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(cleaned) as { items?: string[] };
    return (parsed.items ?? []).map((s) => String(s).trim()).filter(Boolean);
  } catch {
    return [];
  }
}
