import { Injectable, Logger } from '@nestjs/common';
import type { TranscribeResult } from '@meetingmind/ai-provider';
import { AiService } from '../../ai/ai.service';
import { FfmpegService } from '../../media/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import type { PipelineWorker } from './worker.types';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Transcribes meeting audio via Groq Whisper (with chunking for large files).
 */
@Injectable()
export class TranscriptionWorker implements PipelineWorker {
  readonly stage = 'transcription';
  private readonly logger = new Logger(TranscriptionWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  async run(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });

    const paths = this.storage.pathsFor(meetingId);
    const audioPath = meeting.audioPath ?? paths.audio;
    const provider = this.ai.getProvider();

    const usable = await isUsableAudioFile(audioPath);
    if (!usable) {
      throw new Error(
        `No usable audio at ${audioPath}. Import a recording or finish a live capture first.`,
      );
    }

    if (provider.name === 'mock') {
      throw new Error(
        'AI provider is mock — set GROQ_API_KEY in the root .env and restart the API.',
      );
    }

    this.logger.log(`Transcribing ${meetingId} via ${provider.name} Whisper`);

    const chunksDir = path.join(paths.dir, 'audio-chunks');
    const chunks = await this.ffmpeg.splitForWhisper(audioPath, chunksDir);
    this.logger.log(`Whisper upload parts: ${chunks.length}`);

    const merged: TranscribeResult = {
      text: '',
      language: undefined,
      durationSeconds: 0,
      segments: [],
      engine: '',
      model: '',
    };

    let offsetMs = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkPath = chunks[i]!;
      this.logger.log(`Transcribing chunk ${i + 1}/${chunks.length}: ${path.basename(chunkPath)}`);
      const part = await provider.transcribe({
        filePath: chunkPath,
        prompt: 'Meeting discussion with multiple speakers.',
      });

      merged.engine = part.engine;
      merged.model = part.model;
      merged.language = merged.language ?? part.language;
      merged.text = [merged.text, part.text].filter(Boolean).join('\n');
      merged.durationSeconds =
        (merged.durationSeconds ?? 0) + (part.durationSeconds ?? 0);

      for (const seg of part.segments) {
        merged.segments.push({
          ...seg,
          startMs: seg.startMs + offsetMs,
          endMs: seg.endMs + offsetMs,
        });
      }

      const chunkDurationMs =
        part.durationSeconds != null
          ? Math.round(part.durationSeconds * 1000)
          : part.segments.length
            ? Math.max(...part.segments.map((s) => s.endMs))
            : 0;
      offsetMs += chunkDurationMs;
    }

    await this.prisma.transcriptSegment.deleteMany({ where: { meetingId } });

    if (merged.segments.length) {
      await this.prisma.transcriptSegment.createMany({
        data: merged.segments.map((seg) => ({
          meetingId,
          startMs: seg.startMs,
          endMs: seg.endMs,
          speakerLabel: seg.speakerLabel ?? null,
          text: seg.text,
        })),
      });
    } else if (merged.text.trim()) {
      await this.prisma.transcriptSegment.create({
        data: {
          meetingId,
          startMs: 0,
          endMs: Math.round((merged.durationSeconds ?? 0) * 1000),
          speakerLabel: null,
          text: merged.text.trim(),
        },
      });
    }

    await this.storage.writeJson(paths.transcript, {
      meetingId,
      engine: merged.engine,
      model: merged.model,
      language: merged.language,
      durationSeconds: merged.durationSeconds,
      text: merged.text,
      chunks: chunks.length,
      segments: merged.segments,
    });
  }
}

async function isUsableAudioFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size < 256) {
      return false;
    }
    const head = Buffer.alloc(Math.min(128, stat.size));
    const handle = await fs.open(filePath, 'r');
    try {
      await handle.read(head, 0, head.length, 0);
    } finally {
      await handle.close();
    }
    if (head.toString('utf8').includes('MeetingMind placeholder audio')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
