import { Injectable } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  chunkTimedLines,
  dedupeStrings,
  parseJsonItems,
} from '../long-meeting';
import type { PipelineWorker } from './worker.types';

@Injectable()
export class DecisionsWorker implements PipelineWorker {
  readonly stage = 'decisions';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const items = await extractList(this.prisma, this.ai, meetingId, 'decisions');
    await this.prisma.decision.deleteMany({ where: { meetingId } });
    if (items.length) {
      await this.prisma.decision.createMany({
        data: items.map((text) => ({ meetingId, text })),
      });
    }
  }
}

@Injectable()
export class RisksWorker implements PipelineWorker {
  readonly stage = 'risks';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const items = await extractList(this.prisma, this.ai, meetingId, 'risks');
    await this.prisma.risk.deleteMany({ where: { meetingId } });
    if (items.length) {
      await this.prisma.risk.createMany({
        data: items.map((text) => ({ meetingId, text, severity: null })),
      });
    }
  }
}

@Injectable()
export class QuestionsWorker implements PipelineWorker {
  readonly stage = 'questions';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const items = await extractList(this.prisma, this.ai, meetingId, 'questions');
    await this.prisma.question.deleteMany({ where: { meetingId } });
    if (items.length) {
      await this.prisma.question.createMany({
        data: items.map((text) => ({ meetingId, text, answered: false })),
      });
    }
  }
}

async function extractList(
  prisma: PrismaService,
  ai: AiService,
  meetingId: string,
  kind: 'decisions' | 'risks' | 'questions',
): Promise<string[]> {
  const summary = await prisma.meetingSummary.findUnique({ where: { meetingId } });
  const collected: string[] = [];
  if (summary?.rawJson) {
    try {
      const parsed = JSON.parse(summary.rawJson) as Record<string, string[]>;
      if (Array.isArray(parsed[kind])) collected.push(...parsed[kind]!);
    } catch {
      // ignore
    }
  }

  const segments = await prisma.transcriptSegment.findMany({
    where: { meetingId },
    orderBy: { startMs: 'asc' },
  });
  if (!segments.length) return dedupeStrings(collected);

  const labels = {
    decisions: 'decisions that were agreed',
    risks: 'risks or blockers mentioned',
    questions: 'open questions raised',
  };

  const lines = segments.map((s) => ({
    startMs: s.startMs,
    endMs: s.endMs,
    text: `${formatTs(s.startMs)} ${s.speakerLabel ?? ''}: ${s.text}`.trim(),
  }));
  const chunks = chunkTimedLines(lines);

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    const raw = await ai.getProvider().complete({
      system: 'Respond with JSON only: {"items":["..."]}. /no_think',
      prompt: [
        `Extract ${labels[kind]} from this meeting transcript section (${i + 1}/${chunks.length}).`,
        'Return concrete, non-duplicate items. Skip fluff.',
        '',
        chunk.text,
      ].join('\n'),
      temperature: 0.2,
      maxTokens: 1536,
      route: 'extract',
    });
    collected.push(...parseJsonItems(raw));
  }

  return dedupeStrings(collected);
}

function formatTs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
