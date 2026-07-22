/** Strip model chain-of-thought / thinking blocks that sometimes leak into summaries. */
export function stripThinking(text: string | null | undefined): string {
  if (!text) return '';
  let out = text
    .replace(/<think\b[^>]*>[\s\S]*?<\/(?:think|thinking)>/gi, '')
    .replace(/<\/?(?:think|thinking)\b[^>]*>/gi, '');

  const unclosed = out.search(/<think\b/i);
  if (unclosed >= 0) {
    const after = out.slice(unclosed);
    const jsonStart = after.search(/\{[\s\S]*"(?:executive|detailed)"/);
    out =
      out.slice(0, unclosed) +
      (jsonStart >= 0 ? after.slice(jsonStart) : '');
  }

  // If the field is actually a JSON summarize payload, pull executive/detailed out.
  const jsonBlob = extractSummarizeJson(out);
  if (jsonBlob) {
    return jsonBlob.executive || jsonBlob.detailed || '';
  }

  if (looksLikePromptEcho(out)) {
    const lines = out.split(/\n+/);
    const start = lines.findIndex(
      (l) =>
        l.length > 40 &&
        !/thinking|analyze|required keys|deconstruct|role:|transcript|output format/i.test(
          l,
        ),
    );
    if (start >= 0) out = lines.slice(start).join('\n');
  }

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function looksLikePromptEcho(text: string): boolean {
  return (
    /here'?s a thinking process/i.test(text) ||
    /^\s*analyze user input/i.test(text) ||
    /required keys/i.test(text) ||
    /output format/i.test(text)
  );
}

function extractSummarizeJson(
  text: string,
): { executive?: string; detailed?: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        executive?: string;
        detailed?: string;
      };
      if (parsed.executive || parsed.detailed) return parsed;
    } catch {
      // fall through to regex
    }
  }

  const exec = text.match(/"executive"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const detail = text.match(/"detailed"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!exec?.[1] && !detail?.[1]) return null;

  const unescape = (s: string) => {
    try {
      return JSON.parse(`"${s}"`) as string;
    } catch {
      return s.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  };

  return {
    executive: exec?.[1] ? unescape(exec[1]) : undefined,
    detailed: detail?.[1] ? unescape(detail[1]) : undefined,
  };
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return '';
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatTs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function formatMeetingDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'processing':
      return 'Processing';
    case 'recording':
      return 'Recording';
    case 'failed':
      return 'Failed';
    default:
      return status.replaceAll('_', ' ');
  }
}
