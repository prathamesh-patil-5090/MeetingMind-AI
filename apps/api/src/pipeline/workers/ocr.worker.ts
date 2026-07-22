import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { FfmpegService } from '../../media/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import type { PipelineWorker } from './worker.types';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Extract screenshots and OCR visible text via Groq vision.
 */
@Injectable()
export class OcrWorker implements PipelineWorker {
  readonly stage = 'ocr';
  private readonly logger = new Logger(OcrWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
    private readonly ai: AiService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    const paths = this.storage.pathsFor(meetingId);
    const recording =
      meeting.recordingPath && (await exists(meeting.recordingPath))
        ? meeting.recordingPath
        : null;

    if (!recording) {
      this.logger.warn(`No recording for OCR on ${meetingId}`);
      return;
    }

    const frames = await this.ffmpeg.extractScreenshots(recording, paths.screenshots, {
      intervalSeconds: Number(process.env.SCREENSHOT_INTERVAL_SEC ?? 60),
      maxFrames: Number(process.env.SCREENSHOT_MAX_FRAMES ?? 18),
    });

    await this.prisma.ocrResult.deleteMany({ where: { meetingId } });
    await this.prisma.screenshot.deleteMany({ where: { meetingId } });

      const provider = this.ai.getVisionProvider();

    for (const frame of frames) {
      const screenshot = await this.prisma.screenshot.create({
        data: {
          meetingId,
          timestampMs: frame.timestampMs,
          filePath: frame.filePath,
        },
      });

      try {
        const result = await provider.analyzeVision({
          imagePath: frame.filePath,
          prompt: [
            'OCR this meeting screenshot for knowledge capture.',
            'Return JSON only with keys: description, detectedType (slide|diagram|spreadsheet|browser|whiteboard|document|other), extractedTextHints (string[]).',
            'extractedTextHints should include ONLY meaningful on-screen content:',
            'titles, vessel/ship names, IMO, dates, statuses, yard names, amounts, survey names, key form values.',
            'EXCLUDE UI chrome: nav labels, placeholders ("Enter…"), buttons (Cancel/Back/Add), repeated column headers, empty zeros, and generic instructions.',
            'If the frame is mostly UI chrome with no useful content, return extractedTextHints: [].',
          ].join(' '),
        });

        const text = result.extractedTextHints.join('\n').trim() || result.description;
        if (text) {
          await this.prisma.ocrResult.create({
            data: {
              meetingId,
              screenshotId: screenshot.id,
              text,
              confidence: null,
            },
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`OCR failed for ${path.basename(frame.filePath)}: ${message}`);
      }
    }

    this.logger.log(`OCR finished for ${meetingId} (${frames.length} frames)`);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
