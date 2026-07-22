import { Injectable } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PipelineWorker } from './worker.types';

@Injectable()
export class ActionItemsWorker implements PipelineWorker {
  readonly stage = 'action_items';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const summary = await this.prisma.meetingSummary.findUnique({
      where: { meetingId },
    });

    let items: string[] = [];
    if (summary?.rawJson) {
      try {
        const parsed = JSON.parse(summary.rawJson) as { actionItems?: string[] };
        items = parsed.actionItems ?? [];
      } catch {
        items = [];
      }
    }

    if (!items.length) {
      const transcript = await this.prisma.transcriptSegment.findMany({
        where: { meetingId },
        orderBy: { startMs: 'asc' },
      });
      const text = transcript.map((t) => t.text).join('\n');
      const result = await this.ai.getProvider().summarize({
        transcript: text,
        title: 'Action item pass',
      });
      items = result.actionItems;
    }

    await this.prisma.actionItem.deleteMany({ where: { meetingId } });
    if (items.length) {
      await this.prisma.actionItem.createMany({
        data: items.map((text) => ({ meetingId, text })),
      });
    }
  }
}
