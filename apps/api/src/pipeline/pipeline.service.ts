import { formatPipelineError } from '@meetingmind/ai-provider';
import { Injectable, Logger } from '@nestjs/common';
import {
  MeetingStatus,
  PipelineStage,
  PipelineStageStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AudioExtractionWorker } from './workers/audio-extraction.worker';
import { TranscriptionWorker } from './workers/transcription.worker';
import { DiarizationWorker } from './workers/diarization.worker';
import { OcrWorker } from './workers/ocr.worker';
import { VisionWorker } from './workers/vision.worker';
import { TimelineWorker } from './workers/timeline.worker';
import { SummaryWorker } from './workers/summary.worker';
import { ActionItemsWorker } from './workers/action-items.worker';
import {
  DecisionsWorker,
  QuestionsWorker,
  RisksWorker,
} from './workers/phase2-extract.workers';
import { EmbeddingsWorker } from './workers/embeddings.worker';
import { StorageFinalizeWorker } from './workers/storage-finalize.worker';
import type { PipelineWorker } from './workers/worker.types';

/** Full Phase 1 + Phase 2 processing order. */
const PIPELINE_STAGES: PipelineStage[] = [
  PipelineStage.audio_extraction,
  PipelineStage.transcription,
  PipelineStage.diarization,
  PipelineStage.ocr,
  PipelineStage.vision,
  PipelineStage.timeline,
  PipelineStage.summary,
  PipelineStage.action_items,
  PipelineStage.decisions,
  PipelineStage.risks,
  PipelineStage.questions,
  PipelineStage.embeddings,
  PipelineStage.storage,
];

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audioExtraction: AudioExtractionWorker,
    private readonly transcription: TranscriptionWorker,
    private readonly diarization: DiarizationWorker,
    private readonly ocr: OcrWorker,
    private readonly vision: VisionWorker,
    private readonly timeline: TimelineWorker,
    private readonly summary: SummaryWorker,
    private readonly actionItems: ActionItemsWorker,
    private readonly decisions: DecisionsWorker,
    private readonly risks: RisksWorker,
    private readonly questions: QuestionsWorker,
    private readonly embeddings: EmbeddingsWorker,
    private readonly storageFinalize: StorageFinalizeWorker,
  ) {}

  async start(meetingId: string) {
    if (this.running.has(meetingId)) {
      return { meetingId, status: 'already_running' as const };
    }

    for (const stage of PIPELINE_STAGES) {
      await this.prisma.pipelineJob.upsert({
        where: { meetingId_stage: { meetingId, stage } },
        create: {
          meetingId,
          stage,
          status: PipelineStageStatus.pending,
        },
        update: {
          status: PipelineStageStatus.pending,
          error: null,
          startedAt: null,
          completedAt: null,
        },
      });
    }

    void this.run(meetingId);
    return { meetingId, status: 'started' as const };
  }

  async getStatus(meetingId: string) {
    return this.prisma.pipelineJob.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private workers(): Record<string, PipelineWorker> {
    return {
      [PipelineStage.audio_extraction]: this.audioExtraction,
      [PipelineStage.transcription]: this.transcription,
      [PipelineStage.diarization]: this.diarization,
      [PipelineStage.ocr]: this.ocr,
      [PipelineStage.vision]: this.vision,
      [PipelineStage.timeline]: this.timeline,
      [PipelineStage.summary]: this.summary,
      [PipelineStage.action_items]: this.actionItems,
      [PipelineStage.decisions]: this.decisions,
      [PipelineStage.risks]: this.risks,
      [PipelineStage.questions]: this.questions,
      [PipelineStage.embeddings]: this.embeddings,
      [PipelineStage.storage]: this.storageFinalize,
    };
  }

  private async run(meetingId: string) {
    this.running.add(meetingId);
    const workers = this.workers();

    try {
      for (const stage of PIPELINE_STAGES) {
        await this.prisma.pipelineJob.update({
          where: { meetingId_stage: { meetingId, stage } },
          data: {
            status: PipelineStageStatus.running,
            startedAt: new Date(),
            error: null,
          },
        });

        try {
          await workers[stage].run(meetingId);
          await this.prisma.pipelineJob.update({
            where: { meetingId_stage: { meetingId, stage } },
            data: {
              status: PipelineStageStatus.completed,
              completedAt: new Date(),
            },
          });
        } catch (err) {
          const message = formatPipelineError(err);
          this.logger.error(`Stage ${stage} failed for ${meetingId}: ${message}`);
          if (err instanceof Error && err.stack) {
            this.logger.debug(err.stack);
          }
          await this.prisma.pipelineJob.update({
            where: { meetingId_stage: { meetingId, stage } },
            data: {
              status: PipelineStageStatus.failed,
              error: message,
              completedAt: new Date(),
            },
          });
          await this.prisma.meeting.update({
            where: { id: meetingId },
            data: { status: MeetingStatus.failed },
          });
          return;
        }
      }

      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: MeetingStatus.ready },
      });
    } finally {
      this.running.delete(meetingId);
    }
  }
}
