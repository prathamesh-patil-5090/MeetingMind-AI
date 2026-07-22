import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { chunkTimedLines } from '../long-meeting';
import type { PipelineWorker } from './worker.types';

@Injectable()
export class TimelineWorker implements PipelineWorker {
  readonly stage = 'timeline';
  private readonly logger = new Logger(TimelineWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: {
        transcriptSegs: { orderBy: { startMs: 'asc' } },
        visionAnalyses: true,
      },
    });

    const vision = meeting.visionAnalyses.map((v) => `- ${v.description}`).join('\n');
    const lines = meeting.transcriptSegs.map((s) => ({
      startMs: s.startMs,
      endMs: s.endMs,
      text: `${formatTs(s.startMs)} ${s.speakerLabel ?? ''}: ${s.text}`.trim(),
    }));
    const chunks = chunkTimedLines(lines);

    const collected: Array<{
      timestampMs: number;
      label: string;
      description: string | null;
    }> = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      const raw = await this.ai.getProvider().complete({
        system:
          'Build a meeting timeline section. Respond with JSON only: {"events":[{"timestampMs":0,"label":"...","description":"..."}]}. /no_think',
        prompt: [
          `Title: ${meeting.title}`,
          `Section ${i + 1}/${chunks.length} (~${formatTs(chunk.startMs)}–${formatTs(chunk.endMs)}).`,
          'Create 2–6 timeline events for THIS section only (topic shifts, decisions, milestones).',
          'timestampMs must be integers aligned to the transcript timestamps in this section.',
          '',
          'Transcript:',
          chunk.text,
          i === 0 && vision ? `\nVision notes:\n${vision}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        temperature: 0.2,
        maxTokens: 2048,
        route: 'extract',
      });
      collected.push(...parseTimeline(raw));
    }

    // Light dedupe by label+nearby timestamp
    const events = dedupeTimeline(collected);

    await this.prisma.timelineEvent.deleteMany({ where: { meetingId } });

    if (!events.length) {
      await this.prisma.timelineEvent.createMany({
        data: [
          {
            meetingId,
            timestampMs: 0,
            label: 'Meeting started',
            description: meeting.title,
          },
          {
            meetingId,
            timestampMs: meeting.transcriptSegs.at(-1)?.endMs ?? 0,
            label: 'Meeting finished',
            description: null,
          },
        ],
      });
    } else {
      await this.prisma.timelineEvent.createMany({
        data: events.map((e) => ({
          meetingId,
          timestampMs: e.timestampMs,
          label: e.label,
          description: e.description,
        })),
      });
    }

    this.logger.log(
      `Timeline built for ${meetingId} (${events.length} events from ${chunks.length} chunk(s))`,
    );
  }
}

function parseTimeline(raw: string): Array<{
  timestampMs: number;
  label: string;
  description: string | null;
}> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(cleaned) as {
      events?: Array<{ timestampMs?: number; label?: string; description?: string }>;
    };
    return (parsed.events ?? [])
      .filter((e) => e.label)
      .map((e) => ({
        timestampMs: Math.max(0, Math.round(Number(e.timestampMs) || 0)),
        label: String(e.label),
        description: e.description ? String(e.description) : null,
      }));
  } catch {
    return [];
  }
}

function dedupeTimeline(
  events: Array<{ timestampMs: number; label: string; description: string | null }>,
): typeof events {
  const sorted = [...events].sort((a, b) => a.timestampMs - b.timestampMs);
  const out: typeof events = [];
  for (const ev of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.label.toLowerCase() === ev.label.toLowerCase() &&
      Math.abs(prev.timestampMs - ev.timestampMs) < 30_000
    ) {
      continue;
    }
    out.push(ev);
  }
  // Cap to a readable chapter list for 2h meetings.
  if (out.length <= 24) return out;
  const step = out.length / 24;
  return Array.from({ length: 24 }, (_, i) => out[Math.min(out.length - 1, Math.floor(i * step))]!);
}

function formatTs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
