import { Injectable } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import type { PipelineWorker } from './worker.types';

@Injectable()
export class EmbeddingsWorker implements PipelineWorker {
  readonly stage = 'embeddings';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: {
        summary: true,
        transcriptSegs: true,
        actionItems: true,
        decisions: true,
        risks: true,
        questions: true,
        ocrResults: true,
        visionAnalyses: true,
        timelineEvents: true,
      },
    });

    const chunks: Array<{ source: string; sourceId?: string; text: string }> = [];

    if (meeting.summary) {
      chunks.push({
        source: 'summary',
        sourceId: meeting.summary.id,
        text: `${meeting.summary.executive}\n${meeting.summary.detailed}`,
      });
    }

    for (const seg of meeting.transcriptSegs) {
      chunks.push({ source: 'transcript', sourceId: seg.id, text: seg.text });
    }
    for (const item of meeting.actionItems) {
      chunks.push({ source: 'action_item', sourceId: item.id, text: item.text });
    }
    for (const decision of meeting.decisions) {
      chunks.push({ source: 'decision', sourceId: decision.id, text: decision.text });
    }
    for (const risk of meeting.risks) {
      chunks.push({ source: 'risk', sourceId: risk.id, text: risk.text });
    }
    for (const question of meeting.questions) {
      chunks.push({ source: 'question', sourceId: question.id, text: question.text });
    }
    for (const ocr of meeting.ocrResults) {
      chunks.push({ source: 'ocr', sourceId: ocr.id, text: ocr.text });
    }
    for (const vision of meeting.visionAnalyses) {
      chunks.push({ source: 'vision', sourceId: vision.id, text: vision.description });
    }
    for (const event of meeting.timelineEvents) {
      chunks.push({
        source: 'timeline',
        sourceId: event.id,
        text: `${event.label}${event.description ? `: ${event.description}` : ''}`,
      });
    }

    if (!chunks.length) {
      return;
    }

    const embedded = await this.ai.getProvider().embed({
      texts: chunks.map((c) => c.text),
    });

    await this.prisma.embedding.deleteMany({ where: { meetingId } });
    await this.prisma.embedding.createMany({
      data: chunks.map((chunk, i) => ({
        meetingId,
        source: chunk.source,
        sourceId: chunk.sourceId,
        text: chunk.text,
        vectorJson: JSON.stringify(embedded.vectors[i] ?? []),
      })),
    });

    await this.storage.writeJson(this.storage.pathsFor(meetingId).embeddings, {
      meetingId,
      dimensions: embedded.dimensions,
      count: chunks.length,
      provider: this.ai.getProvider().name,
    });
  }
}
