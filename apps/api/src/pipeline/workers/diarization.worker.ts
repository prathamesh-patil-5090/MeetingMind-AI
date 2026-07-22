import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { longMeetingChunkChars } from '../long-meeting';
import type { PipelineWorker } from './worker.types';

/**
 * Assign speaker labels to transcript segments using the LLM
 * (true acoustic diarization can replace this later with WhisperX/pyannote).
 */
@Injectable()
export class DiarizationWorker implements PipelineWorker {
  readonly stage = 'diarization';
  private readonly logger = new Logger(DiarizationWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const segments = await this.prisma.transcriptSegment.findMany({
      where: { meetingId },
      orderBy: { startMs: 'asc' },
    });

    if (!segments.length) {
      this.logger.warn(`No transcript segments for ${meetingId}`);
      return;
    }

    // Batch by approximate prompt size so 2h meetings stay in-context.
    const maxChars = Math.min(8000, longMeetingChunkChars());
    const batches: Array<typeof segments> = [];
    let batch: typeof segments = [];
    let batchChars = 0;

    for (const seg of segments) {
      const lineLen = seg.text.length + 24;
      if (batch.length && batchChars + lineLen > maxChars) {
        batches.push(batch);
        batch = [];
        batchChars = 0;
      }
      batch.push(seg);
      batchChars += lineLen;
    }
    if (batch.length) batches.push(batch);

    const labels: Array<string | null> = new Array(segments.length).fill(null);
    let offset = 0;
    let continuityHint = 'Prefer Speakers already used: none yet.';

    for (let b = 0; b < batches.length; b += 1) {
      const part = batches[b]!;
      const numbered = part
        .map((s, i) => `[${i}] (${formatTs(s.startMs)}) ${s.text}`)
        .join('\n');

      const raw = await this.ai.getProvider().complete({
        system:
          'You label speakers in meeting transcripts. Respond with JSON only: {"labels":[{"index":0,"speaker":"Speaker 1"},...]}. /no_think',
        prompt: [
          `Batch ${b + 1}/${batches.length}. Assign consistent speaker labels.`,
          continuityHint,
          'IMPORTANT: Product demos / walkthrough videos are usually ONE narrator.',
          'Do NOT alternate speakers every sentence. Only introduce Speaker 2+ when the voice or role clearly changes.',
          'Prefer continuity: keep the same speaker across consecutive segments unless there is a clear change.',
          'Use the fewest speakers that fit. Return one entry per index in THIS batch (0-based within the batch).',
          '',
          numbered,
        ].join('\n'),
        temperature: 0.1,
        maxTokens: 2048,
        route: 'extract',
      });

      const batchLabels = parseSpeakerLabels(raw, part.length);
      const used = new Set<string>();
      for (let i = 0; i < part.length; i += 1) {
        const speaker =
          batchLabels[i] ??
          labels[offset + i - 1] ??
          part[i]!.speakerLabel ??
          'Speaker 1';
        labels[offset + i] = speaker;
        used.add(speaker);
      }
      continuityHint = `Prefer Speakers already used: ${[...used].join(', ') || 'Speaker 1'}. Keep names stable across batches.`;
      offset += part.length;
    }

    for (let i = 0; i < segments.length; i += 1) {
      await this.prisma.transcriptSegment.update({
        where: { id: segments[i]!.id },
        data: { speakerLabel: labels[i] ?? 'Speaker 1' },
      });
    }

    this.logger.log(
      `Labeled ${segments.length} segments for ${meetingId} (${batches.length} batch(es))`,
    );
  }
}

function parseSpeakerLabels(raw: string, count: number): Array<string | null> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const out: Array<string | null> = new Array(count).fill(null);
  try {
    const parsed = JSON.parse(cleaned) as {
      labels?: Array<{ index?: number; speaker?: string }>;
    };
    for (const item of parsed.labels ?? []) {
      if (
        typeof item.index === 'number' &&
        item.index >= 0 &&
        item.index < count &&
        item.speaker
      ) {
        out[item.index] = item.speaker.trim();
      }
    }
  } catch {
    // Fallback handled by caller.
  }
  return out;
}

function formatTs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
