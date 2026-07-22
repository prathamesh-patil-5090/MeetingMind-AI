import { BadRequestException, Injectable } from '@nestjs/common';
import { MeetingStatus } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';

export type AskMessage = { role: 'user' | 'assistant'; content: string };

export type KnowledgeCitation = {
  meetingId: string;
  meetingTitle: string;
  source: string;
  snippet: string;
};

@Injectable()
export class KnowledgeAskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly search: SearchService,
  ) {}

  async ask(
    question: string,
    history: AskMessage[] = [],
  ): Promise<{ answer: string; citations: KnowledgeCitation[] }> {
    const q = question?.trim();
    if (!q) {
      throw new BadRequestException('question is required');
    }

    const hits = await this.search.semanticSearch(q, 16);
    const byMeeting = new Map<
      string,
      { title: string; snippets: Array<{ source: string; text: string; score: number }> }
    >();

    for (const hit of hits) {
      const entry = byMeeting.get(hit.meetingId) ?? {
        title: hit.meetingTitle,
        snippets: [],
      };
      entry.snippets.push({
        source: hit.source,
        text: hit.snippet,
        score: hit.score,
      });
      byMeeting.set(hit.meetingId, entry);
    }

    const topMeetingIds = [...byMeeting.entries()]
      .map(([id, data]) => ({
        id,
        title: data.title,
        best: Math.max(...data.snippets.map((s) => s.score), 0),
      }))
      .sort((a, b) => b.best - a.best)
      .slice(0, 5)
      .map((m) => m.id);

    if (!topMeetingIds.length) {
      const recent = await this.prisma.meeting.findMany({
        where: { status: MeetingStatus.ready },
        orderBy: { startedAt: 'desc' },
        take: 5,
        select: { id: true, title: true },
      });
      for (const m of recent) {
        topMeetingIds.push(m.id);
        byMeeting.set(m.id, { title: m.title, snippets: [] });
      }
    }

    const meetings = await this.prisma.meeting.findMany({
      where: { id: { in: topMeetingIds } },
      include: {
        summary: true,
        actionItems: { take: 8 },
        decisions: { take: 8 },
        risks: { take: 5 },
        topics: true,
      },
    });

    const order = new Map(topMeetingIds.map((id, i) => [id, i]));
    meetings.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

    const citations: KnowledgeCitation[] = [];
    const blocks: string[] = [];

    for (const meeting of meetings) {
      const hit = byMeeting.get(meeting.id);
      const parts: string[] = [
        `### Meeting: ${meeting.title} (id: ${meeting.id})`,
        `Date: ${meeting.startedAt.toISOString().slice(0, 10)}`,
      ];

      if (meeting.summary?.executive) {
        parts.push(`Executive summary:\n${meeting.summary.executive}`);
        citations.push({
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          source: 'summary',
          snippet: meeting.summary.executive.slice(0, 220),
        });
      }

      if (meeting.topics.length) {
        parts.push(`Topics: ${meeting.topics.map((t) => t.name).join(', ')}`);
      }
      if (meeting.decisions.length) {
        parts.push(
          `Decisions:\n${meeting.decisions.map((d) => `- ${d.text}`).join('\n')}`,
        );
        citations.push({
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          source: 'decisions',
          snippet: meeting.decisions[0]!.text.slice(0, 220),
        });
      }
      if (meeting.actionItems.length) {
        parts.push(
          `Action items:\n${meeting.actionItems.map((a) => `- ${a.text}`).join('\n')}`,
        );
      }
      if (meeting.risks.length) {
        parts.push(`Risks:\n${meeting.risks.map((r) => `- ${r.text}`).join('\n')}`);
      }

      const snippets = (hit?.snippets ?? [])
        .filter((s) => s.source !== 'keyword')
        .slice(0, 4);
      if (snippets.length) {
        parts.push(
          `Retrieved passages:\n${snippets.map((s) => `- [${s.source}] ${s.text}`).join('\n')}`,
        );
        for (const s of snippets.slice(0, 2)) {
          citations.push({
            meetingId: meeting.id,
            meetingTitle: meeting.title,
            source: s.source,
            snippet: s.text.slice(0, 220),
          });
        }
      }

      blocks.push(parts.join('\n'));
    }

    const context = blocks.join('\n\n').slice(0, 16000);
    const historyText = history
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const answer = await this.ai.getProvider().complete({
      system: [
        'You are MeetingMind, a meeting knowledge assistant.',
        'Answer using ONLY the provided multi-meeting context.',
        'When you use evidence, name the meeting title in parentheses.',
        'If several meetings disagree or cover different times, say so clearly.',
        'If the context does not contain the answer, say you do not have enough information across stored meetings.',
        'Be concise and practical. Do not invent facts. /no_think',
      ].join(' '),
      prompt: [
        'Knowledge context from meetings:',
        context || '(No meetings found yet.)',
        historyText ? `\nRecent chat:\n${historyText}` : '',
        `\nUser question: ${q}`,
        '\nAnswer:',
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0.2,
      maxTokens: 2048,
      route: 'chat',
      jsonMode: false,
    });

    const uniqueCitations = dedupeCitations(citations).slice(0, 8);

    return {
      answer: answer.trim(),
      citations: uniqueCitations,
    };
  }
}

function dedupeCitations(items: KnowledgeCitation[]): KnowledgeCitation[] {
  const seen = new Set<string>();
  const out: KnowledgeCitation[] = [];
  for (const c of items) {
    const key = `${c.meetingId}:${c.source}:${c.snippet.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
