import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FfmpegService } from '../../media/ffmpeg.service';
import type { PipelineWorker } from './worker.types';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Prepares compact speech audio for Groq Whisper (extract + optional later chunking).
 */
@Injectable()
export class AudioExtractionWorker implements PipelineWorker {
  readonly stage = 'audio_extraction';
  private readonly logger = new Logger(AudioExtractionWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const paths = this.storage.pathsFor(meetingId);
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });

    const recordingPath =
      meeting.recordingPath && (await fileExists(meeting.recordingPath))
        ? meeting.recordingPath
        : await this.findRecordingInDir(paths.dir);

    if (!recordingPath) {
      const audioPath = paths.audio;
      await fs.writeFile(
        audioPath,
        '# MeetingMind placeholder audio — replace with ffmpeg extract\n',
        'utf8',
      );
      this.logger.warn(`No recording found; created placeholder for ${meetingId}`);
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { audioPath },
      });
      return;
    }

    const audioMp3 = path.join(paths.dir, 'audio.mp3');

    try {
      await this.ffmpeg.extractSpeechMp3(recordingPath, audioMp3);
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: {
          recordingPath,
          audioPath: audioMp3,
        },
      });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`ffmpeg extract failed (${message}); falling back to recording file`);
    }

    // Fallback: point Whisper at the recording (only works for small Groq-compatible files).
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: {
        recordingPath,
        audioPath: recordingPath,
      },
    });
  }

  private async findRecordingInDir(dir: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(dir);
      const hit = entries.find((name) => name.startsWith('recording.'));
      return hit ? path.join(dir, hit) : null;
    } catch {
      return null;
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}
