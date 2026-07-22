import { Injectable, Logger } from '@nestjs/common';
import type { SummarizeResult } from '@meetingmind/ai-provider';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  chunkText,
  dedupeStrings,
  longMeetingChunkChars,
} from '../long-meeting';
import type { PipelineWorker } from './worker.types';

@Injectable()
export class SummaryWorker implements PipelineWorker {
  readonly stage = 'summary';
  private readonly logger = new Logger(SummaryWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: {
        transcriptSegs: { orderBy: { startMs: 'asc' } },
        ocrResults: true,
        visionAnalyses: true,
      },
    });

    const transcript = meeting.transcriptSegs
      .map((s) => `${formatTs(s.startMs)}\n${s.speakerLabel ?? 'Unknown'}:\n${s.text}`)
      .join('\n\n');

    const ocrText = meeting.ocrResults.map((o) => o.text).join('\n\n');
    const visionNotes = meeting.visionAnalyses.map((v) => v.description);
    const provider = this.ai.getProvider();
    const chunkLimit = longMeetingChunkChars();

    let result: SummarizeResult;

    if (transcript.length <= chunkLimit * 1.15) {
      result = await provider.summarize({
        title: meeting.title,
        transcript,
        ocrText: ocrText || undefined,
        visionNotes: visionNotes.length ? visionNotes : undefined,
      });
    } else {
      const chunks = chunkText(transcript, chunkLimit);
      this.logger.log(
        `Long meeting summarize: ${chunks.length} chunk(s) (~${transcript.length} chars)`,
      );

      const partials: SummarizeResult[] = [];
      for (let i = 0; i < chunks.length; i += 1) {
        this.logger.log(`Summarizing chunk ${i + 1}/${chunks.length}`);
        const part = await provider.summarize({
          title: `${meeting.title} (part ${i + 1}/${chunks.length})`,
          transcript: chunks[i]!,
          // Attach OCR/vision only on the first chunk to avoid repetition.
          ocrText: i === 0 && ocrText ? ocrText : undefined,
          visionNotes: i === 0 && visionNotes.length ? visionNotes : undefined,
        });
        partials.push(part);
      }

      result = await this.mergePartials(meeting.title, partials);
    }

    await this.prisma.meetingSummary.upsert({
      where: { meetingId },
      create: {
        meetingId,
        executive: result.executive,
        detailed: result.detailed,
        rawJson: JSON.stringify(result),
      },
      update: {
        executive: result.executive,
        detailed: result.detailed,
        rawJson: JSON.stringify(result),
      },
    });

    await this.prisma.topic.deleteMany({ where: { meetingId } });
    if (result.topics.length) {
      await this.prisma.topic.createMany({
        data: result.topics.map((name) => ({ meetingId, name })),
      });
    }

    await this.storage.writeJson(this.storage.pathsFor(meetingId).summary, result);
  }

  private async mergePartials(
    title: string,
    partials: SummarizeResult[],
  ): Promise<SummarizeResult> {
    const provider = this.ai.getProvider();
    const packed = partials.map((p, i) => ({
      part: i + 1,
      executive: p.executive,
      detailed: p.detailed,
      topics: p.topics,
      actionItems: p.actionItems,
      decisions: p.decisions,
      risks: p.risks,
      questions: p.questions,
    }));

    const raw = await provider.complete({
      system:
        'Merge meeting part-summaries into one JSON object. Keys: executive, detailed, topics, actionItems, decisions, risks, questions. No markdown. /no_think',
      prompt: [
        `Title: ${title}`,
        'Combine these chronological part summaries into one coherent meeting report.',
        'Deduplicate overlapping items. Keep concrete names, numbers, and owners.',
        'executive: 2–4 sentences covering the whole meeting.',
        'detailed: structured narrative covering beginning → middle → end.',
        '',
        JSON.stringify(packed, null, 2),
      ].join('\n'),
      temperature: 0.2,
      maxTokens: 4096,
      route: 'chat',
    });

    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const parsed = JSON.parse(cleaned) as Partial<SummarizeResult>;
      return {
        executive: String(parsed.executive ?? partials[0]?.executive ?? ''),
        detailed: String(parsed.detailed ?? partials.map((p) => p.detailed).join('\n\n')),
        topics: dedupeStrings([
          ...(parsed.topics ?? []),
          ...partials.flatMap((p) => p.topics),
        ], 20),
        actionItems: dedupeStrings([
          ...(parsed.actionItems ?? []),
          ...partials.flatMap((p) => p.actionItems),
        ]),
        decisions: dedupeStrings([
          ...(parsed.decisions ?? []),
          ...partials.flatMap((p) => p.decisions),
        ]),
        risks: dedupeStrings([
          ...(parsed.risks ?? []),
          ...partials.flatMap((p) => p.risks),
        ]),
        questions: dedupeStrings([
          ...(parsed.questions ?? []),
          ...partials.flatMap((p) => p.questions),
        ]),
      };
    } catch {
      return {
        executive: partials.map((p) => p.executive).filter(Boolean).join(' '),
        detailed: partials.map((p) => p.detailed).filter(Boolean).join('\n\n'),
        topics: dedupeStrings(partials.flatMap((p) => p.topics), 20),
        actionItems: dedupeStrings(partials.flatMap((p) => p.actionItems)),
        decisions: dedupeStrings(partials.flatMap((p) => p.decisions)),
        risks: dedupeStrings(partials.flatMap((p) => p.risks)),
        questions: dedupeStrings(partials.flatMap((p) => p.questions)),
      };
    }
  }
}

function formatTs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
