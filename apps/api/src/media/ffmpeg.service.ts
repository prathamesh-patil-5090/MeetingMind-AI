import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as path from 'path';
import ffmpegStatic from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

/** Stay under Groq's 25MB Whisper upload limit. */
export const GROQ_MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);

  getBinaryPath(): string {
    if (!ffmpegStatic) {
      throw new Error('ffmpeg-static binary not found');
    }
    return ffmpegStatic;
  }

  async probeDurationSeconds(filePath: string): Promise<number | null> {
    try {
      // ffmpeg prints Duration on stderr when probing with -i
      await execFileAsync(this.getBinaryPath(), ['-i', filePath], {
        windowsHide: true,
      });
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? err);
      const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      if (!match) return null;
      const h = Number(match[1]);
      const m = Number(match[2]);
      const s = Number(match[3]);
      return h * 3600 + m * 60 + s;
    }
    return null;
  }

  /**
   * Extract mono speech audio as compact mp3 for Whisper.
   */
  async extractSpeechMp3(inputPath: string, outputPath: string): Promise<string> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await execFileAsync(
      this.getBinaryPath(),
      [
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '48k',
        outputPath,
      ],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    );
    const stat = await fs.stat(outputPath);
    this.logger.log(
      `Extracted speech audio ${(stat.size / (1024 * 1024)).toFixed(1)}MB → ${outputPath}`,
    );
    return outputPath;
  }

  /**
   * Split a large audio file into chunks under Groq's upload limit.
   * Returns chunk paths in order.
   */
  async splitForWhisper(audioPath: string, chunksDir: string): Promise<string[]> {
    await fs.mkdir(chunksDir, { recursive: true });
    const stat = await fs.stat(audioPath);
    if (stat.size <= GROQ_MAX_UPLOAD_BYTES) {
      return [audioPath];
    }

    const duration = (await this.probeDurationSeconds(audioPath)) ?? 0;
    if (duration <= 0) {
      throw new Error(
        `Audio is ${(stat.size / (1024 * 1024)).toFixed(1)}MB (over Groq 25MB limit) and duration could not be probed for chunking`,
      );
    }

    const bytesPerSecond = stat.size / duration;
    // Keep a margin under the hard limit.
    const chunkSeconds = Math.max(
      60,
      Math.floor((GROQ_MAX_UPLOAD_BYTES * 0.85) / bytesPerSecond),
    );

    this.logger.log(
      `Splitting ${(stat.size / (1024 * 1024)).toFixed(1)}MB audio (~${Math.round(duration)}s) into ~${chunkSeconds}s chunks`,
    );

    const pattern = path.join(chunksDir, 'chunk_%03d.mp3');
    await execFileAsync(
      this.getBinaryPath(),
      [
        '-y',
        '-i',
        audioPath,
        '-f',
        'segment',
        '-segment_time',
        String(chunkSeconds),
        '-reset_timestamps',
        '1',
        '-c',
        'copy',
        pattern,
      ],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    );

    const files = (await fs.readdir(chunksDir))
      .filter((f) => f.startsWith('chunk_') && f.endsWith('.mp3'))
      .sort();
    if (!files.length) {
      throw new Error('ffmpeg produced no audio chunks');
    }
    return files.map((f) => path.join(chunksDir, f));
  }

  /**
   * Capture meeting screenshots every `intervalSeconds` (capped at maxFrames).
   * Returns absolute paths sorted by frame order.
   */
  async extractScreenshots(
    videoPath: string,
    outputDir: string,
    options?: { intervalSeconds?: number; maxFrames?: number },
  ): Promise<Array<{ filePath: string; timestampMs: number }>> {
    const duration = (await this.probeDurationSeconds(videoPath)) ?? 0;
    const maxFrames = options?.maxFrames ?? 12;
    const minInterval = options?.intervalSeconds ?? 12;

    // Spread frames across the whole recording (critical for 1.5–2h meetings).
    // Otherwise fps=1/interval + maxFrames only covers the opening minutes.
    const spreadInterval =
      duration > 0 ? Math.max(minInterval, duration / Math.max(1, maxFrames)) : minInterval;
    const intervalSeconds = Math.max(20, Math.round(spreadInterval));

    await fs.mkdir(outputDir, { recursive: true });
    // Clear prior frames so re-runs stay deterministic.
    for (const name of await fs.readdir(outputDir)) {
      if (name.startsWith('frame_') && name.endsWith('.jpg')) {
        await fs.unlink(path.join(outputDir, name));
      }
    }

    const pattern = path.join(outputDir, 'frame_%04d.jpg');

    // fps = 1/interval → one frame every N seconds
    await execFileAsync(
      this.getBinaryPath(),
      [
        '-y',
        '-i',
        videoPath,
        '-vf',
        `fps=1/${intervalSeconds}`,
        '-q:v',
        '5',
        '-frames:v',
        String(maxFrames),
        pattern,
      ],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    );

    const files = (await fs.readdir(outputDir))
      .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
      .sort();

    const results = files.map((name, index) => ({
      filePath: path.join(outputDir, name),
      timestampMs: Math.round(index * intervalSeconds * 1000),
    }));

    this.logger.log(
      `Captured ${results.length} screenshots from ${path.basename(videoPath)}` +
        (duration
          ? ` (~${Math.round(duration)}s, every ~${intervalSeconds}s)`
          : ''),
    );
    return results;
  }

  /**
   * MediaRecorder WebM often lacks a cue index, so HTML5 seeking fails even with HTTP Range.
   * Remux with stream copy to rebuild the container index (fast, no re-encode).
   */
  async ensureSeekableRecording(inputPath: string): Promise<string> {
    const ext = path.extname(inputPath).toLowerCase();
    if (ext === '.mp4' || ext === '.mov' || ext === '.m4a' || ext === '.mp3') {
      return inputPath;
    }

    const dir = path.dirname(inputPath);
    const seekableWebm = path.join(dir, 'recording.seekable.webm');
    const seekableMp4 = path.join(dir, 'recording.mp4');

    if (await fileOk(seekableMp4)) return seekableMp4;
    if (await fileOk(seekableWebm)) return seekableWebm;

    try {
      await execFileAsync(
        this.getBinaryPath(),
        ['-y', '-fflags', '+genpts', '-i', inputPath, '-c', 'copy', seekableWebm],
        { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      );
      if (await fileOk(seekableWebm)) {
        this.logger.log(`Rewrote seekable WebM → ${seekableWebm}`);
        return seekableWebm;
      }
    } catch (err) {
      this.logger.warn(
        `Seekable WebM remux failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Fallback: re-encode to MP4 (slower, widely seekable in Chromium).
    try {
      await execFileAsync(
        this.getBinaryPath(),
        [
          '-y',
          '-i',
          inputPath,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          seekableMp4,
        ],
        { windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
      );
      if (await fileOk(seekableMp4)) {
        this.logger.log(`Re-encoded seekable MP4 → ${seekableMp4}`);
        return seekableMp4;
      }
    } catch (err) {
      this.logger.warn(
        `Seekable MP4 encode failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return inputPath;
  }
}

async function fileOk(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}
