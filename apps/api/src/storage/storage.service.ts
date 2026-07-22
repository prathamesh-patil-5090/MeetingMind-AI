import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MEETING_STORAGE_LAYOUT } from '@meetingmind/shared';
import { promises as fs } from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService implements OnModuleInit {
  private meetingsRoot!: string;
  private dataRoot!: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.dataRoot = path.resolve(this.config.get<string>('DATA_DIR') ?? './data');
    this.meetingsRoot = path.resolve(
      this.config.get<string>('MEETINGS_DIR') ?? './meetings',
    );
    await fs.mkdir(this.dataRoot, { recursive: true });
    await fs.mkdir(this.meetingsRoot, { recursive: true });
  }

  getMeetingsRoot(): string {
    return this.meetingsRoot;
  }

  meetingDir(meetingId: string): string {
    return path.join(this.meetingsRoot, meetingId);
  }

  async ensureMeetingLayout(meetingId: string): Promise<string> {
    const dir = this.meetingDir(meetingId);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(dir, MEETING_STORAGE_LAYOUT.screenshotsDir), {
      recursive: true,
    });
    return dir;
  }

  async writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  pathsFor(meetingId: string) {
    const dir = this.meetingDir(meetingId);
    return {
      dir,
      recording: path.join(dir, MEETING_STORAGE_LAYOUT.recording),
      audio: path.join(dir, MEETING_STORAGE_LAYOUT.audio),
      transcript: path.join(dir, MEETING_STORAGE_LAYOUT.transcript),
      summary: path.join(dir, MEETING_STORAGE_LAYOUT.summary),
      metadata: path.join(dir, MEETING_STORAGE_LAYOUT.metadata),
      embeddings: path.join(dir, MEETING_STORAGE_LAYOUT.embeddings),
      screenshots: path.join(dir, MEETING_STORAGE_LAYOUT.screenshotsDir),
    };
  }
}
