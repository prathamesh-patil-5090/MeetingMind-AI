import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PipelineWorker } from './worker.types';
import * as path from 'path';

/**
 * Describe meeting screenshots (slides, boards, apps) via Groq vision.
 * Reuses screenshots already captured by the OCR stage when present.
 */
@Injectable()
export class VisionWorker implements PipelineWorker {
  readonly stage = 'vision';
  private readonly logger = new Logger(VisionWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const screenshots = await this.prisma.screenshot.findMany({
      where: { meetingId },
      orderBy: { timestampMs: 'asc' },
    });

    if (!screenshots.length) {
      this.logger.warn(`No screenshots for vision on ${meetingId}`);
      return;
    }

    await this.prisma.visionAnalysis.deleteMany({ where: { meetingId } });
    const provider = this.ai.getVisionProvider();

    for (const shot of screenshots) {
      try {
        const result = await provider.analyzeVision({
          imagePath: shot.filePath,
          prompt: [
            'Describe this meeting screen for a knowledge base. Return JSON only with keys:',
            'description (what is shown and why it matters),',
            'detectedType (slide|diagram|spreadsheet|browser|whiteboard|document|other),',
            'extractedTextHints (important visible labels only).',
          ].join(' '),
        });

        await this.prisma.visionAnalysis.create({
          data: {
            meetingId,
            screenshotId: shot.id,
            description: result.description,
            detectedType: result.detectedType,
            rawJson: JSON.stringify(result),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Vision failed for ${path.basename(shot.filePath)}: ${message}`);
      }
    }

    this.logger.log(`Vision finished for ${meetingId} (${screenshots.length} frames)`);
  }
}
