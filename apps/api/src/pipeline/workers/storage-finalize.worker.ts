import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import type { PipelineWorker } from './worker.types';

@Injectable()
export class StorageFinalizeWorker implements PipelineWorker {
  readonly stage = 'storage';

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: {
        summary: true,
        actionItems: true,
        decisions: true,
        topics: true,
        pipelineJobs: true,
      },
    });

    await this.storage.writeJson(this.storage.pathsFor(meetingId).metadata, {
      id: meeting.id,
      title: meeting.title,
      platform: meeting.platform,
      status: meeting.status,
      startedAt: meeting.startedAt.toISOString(),
      endedAt: meeting.endedAt?.toISOString() ?? null,
      durationSeconds: meeting.durationSeconds,
      recordingPath: meeting.recordingPath,
      audioPath: meeting.audioPath,
      topics: meeting.topics.map((t) => t.name),
      actionItemCount: meeting.actionItems.length,
      decisionCount: meeting.decisions.length,
      pipeline: meeting.pipelineJobs.map((j) => ({
        stage: j.stage,
        status: j.status,
        error: j.error,
      })),
    });
  }
}
