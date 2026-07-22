import { Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchResult {
  meetingId: string;
  meetingTitle: string;
  snippet: string;
  score: number;
  source: string;
  sourceId: string | null;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async semanticSearch(query: string, limit = 20): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];

    const [{ vectors }] = await Promise.all([
      this.ai.getProvider().embed({ texts: [q] }),
    ]);
    const queryVec = vectors[0] ?? [];

    const embeddings = await this.prisma.embedding.findMany({
      include: { meeting: { select: { id: true, title: true } } },
    });

    const scored = embeddings
      .map((row) => {
        let vec: number[] = [];
        try {
          vec = JSON.parse(row.vectorJson) as number[];
        } catch {
          vec = [];
        }
        return {
          meetingId: row.meetingId,
          meetingTitle: row.meeting.title,
          snippet: row.text.slice(0, 280),
          score: cosineSimilarity(queryVec, vec),
          source: row.source,
          sourceId: row.sourceId,
        };
      })
      .filter((r) => Number.isFinite(r.score) && r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Also blend keyword hits from SQLite for recall.
    const keyword = await this.prisma.meeting.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { summary: { executive: { contains: q } } },
          { summary: { detailed: { contains: q } } },
          { transcriptSegs: { some: { text: { contains: q } } } },
          { decisions: { some: { text: { contains: q } } } },
          { actionItems: { some: { text: { contains: q } } } },
        ],
      },
      take: 10,
      include: { summary: true },
    });

    const merged = new Map<string, SearchResult>();
    for (const hit of scored) {
      merged.set(`${hit.meetingId}:${hit.source}:${hit.sourceId}`, hit);
    }
    for (const m of keyword) {
      const key = `${m.id}:keyword:title`;
      if (!merged.has(key)) {
        merged.set(key, {
          meetingId: m.id,
          meetingTitle: m.title,
          snippet: m.summary?.executive ?? m.title,
          score: 0.35,
          source: 'keyword',
          sourceId: null,
        });
      }
    }

    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
