import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SpeakerAvatar } from '../components/SpeakerAvatar';
import { StatusPill } from '../components/StatusPill';
import {
  findActiveSegmentId,
  VideoWithCaptions,
} from '../components/VideoWithCaptions';
import { api, type MeetingDetail } from '../lib/api';
import { speakerColor } from '../lib/speakers';
import {
  formatDuration,
  formatMeetingDate,
  formatTs,
  stripThinking,
} from '../lib/text';

type TabId = 'summary' | 'transcript' | 'chapters' | 'insights';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'insights', label: 'Insights' },
];

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('summary');
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeSegRef = useRef<HTMLDivElement | null>(null);

  const activeSegmentId = useMemo(
    () => findActiveSegmentId(meeting?.transcriptSegs ?? [], playbackMs),
    [meeting?.transcriptSegs, playbackMs],
  );

  useEffect(() => {
    if (tab !== 'transcript' || !activeSegmentId) return;
    activeSegRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeSegmentId, tab]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      try {
        const data = await api.getMeeting(id!);
        if (!cancelled) setMeeting(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    const timer = window.setInterval(() => {
      if (meeting?.status === 'processing' || meeting?.status === 'recording') {
        void load();
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, meeting?.status]);

  useEffect(() => {
    if (!meeting?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        if (meeting.recordingPath) {
          const url = await api.mediaUrl(meeting.id, 'recording');
          if (!cancelled) setMediaSrc(url);
          return;
        }
        if (meeting.audioPath) {
          const url = await api.mediaUrl(meeting.id, 'audio');
          if (!cancelled) setMediaSrc(url);
          return;
        }
        if (!cancelled) setMediaSrc(null);
      } catch {
        if (!cancelled) setMediaSrc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meeting?.id, meeting?.recordingPath, meeting?.audioPath, meeting?.status]);

  const speakers = useMemo(() => {
    const map = new Map<string, number>();
    for (const seg of meeting?.transcriptSegs ?? []) {
      const key = seg.speakerLabel ?? 'Unknown';
      map.set(key, (map.get(key) ?? 0) + (seg.endMs - seg.startMs));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, ms]) => ({ label, ms }));
  }, [meeting?.transcriptSegs]);

  function seekTo(ms: number) {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    void el.play().catch(() => undefined);
  }

  async function reprocess() {
    if (!meeting) return;
    setReprocessing(true);
    try {
      await api.processMeeting(meeting.id);
      setMeeting(await api.getMeeting(meeting.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReprocessing(false);
    }
  }

  if (error && !meeting) {
    return (
      <div className="p-8 text-sm text-[var(--danger)]">
        {error} · <Link to="/">Back</Link>
      </div>
    );
  }

  if (!meeting) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Loading report…</div>;
  }

  const executiveRaw = stripThinking(meeting.summary?.executive);
  const detailedRaw = stripThinking(meeting.summary?.detailed);
  // If executive is still prompt-echo, prefer a clean detailed paragraph.
  const executive =
    executiveRaw &&
    !/required keys|output format|thinking process|analyze user input/i.test(
      executiveRaw,
    )
      ? executiveRaw
      : detailedRaw.split(/\n\n/)[0] || executiveRaw;
  const detailed =
    detailedRaw && detailedRaw !== executive ? detailedRaw : '';
  const topics =
    meeting.topics?.map((t) => t.name).filter(Boolean) ??
    [];

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg-elevated)]/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              to="/"
              className="text-xs font-medium text-[var(--text-muted)] transition hover:text-[var(--accent)]"
            >
              ← Meetings
            </Link>
            <h1 className="mt-1 truncate text-xl font-bold tracking-tight text-[var(--text)]">
              {meeting.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
              <StatusPill status={meeting.status} />
              <span>{formatMeetingDate(meeting.startedAt)}</span>
              {meeting.durationSeconds != null && (
                <>
                  <span className="text-[var(--border)]">·</span>
                  <span>{formatDuration(meeting.durationSeconds)}</span>
                </>
              )}
              {speakers.length > 0 && (
                <>
                  <span className="text-[var(--border)]">·</span>
                  <span>
                    {speakers.length} speaker{speakers.length === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={reprocessing || meeting.status === 'processing'}
            onClick={() => void reprocess()}
            className="rounded-xl border border-[var(--border)] bg-white px-3.5 py-2 text-sm font-medium text-[var(--text-muted)] shadow-[var(--shadow-sm)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            {reprocessing || meeting.status === 'processing' ? 'Processing…' : 'Re-run pipeline'}
          </button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1400px] gap-6 p-6 lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-[108px] lg:self-start">
          {mediaSrc ? (
            <VideoWithCaptions
              mediaSrc={mediaSrc}
              segments={meeting.transcriptSegs}
              videoRef={videoRef}
              onTimeMs={setPlaybackMs}
              activeSegmentId={activeSegmentId}
            />
          ) : (
            <div className="overflow-hidden rounded-2xl bg-[#0f0e17] shadow-[var(--shadow-md)]">
              <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#2a2150] to-[#0f0e17] px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white/80">
                  ▶
                </div>
                <p className="text-sm font-medium text-white/80">No playback yet</p>
                <p className="text-xs text-white/45">
                  Recording appears here after import or capture finishes.
                </p>
              </div>
            </div>
          )}

          {speakers.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-sm)]">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Speakers
              </h3>
              <ul className="mt-3 space-y-3">
                {speakers.map(({ label, ms }) => {
                  const total = speakers.reduce((s, x) => s + x.ms, 0) || 1;
                  const pct = Math.round((ms / total) * 100);
                  return (
                    <li key={label} className="flex items-center gap-3">
                      <SpeakerAvatar label={label} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2 text-sm">
                          <span className="truncate font-medium">{label}</span>
                          <span className="text-[var(--text-muted)]">{pct}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-soft)]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: speakerColor(label) }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>

        <section className="min-w-0">
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-[var(--border)] bg-white p-1 shadow-[var(--shadow-sm)]">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  tab === t.id
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'summary' && (
            <div className="space-y-4">
              <ReportCard title="Overview">
                {executive || detailed ? (
                  <div className="space-y-3 text-[15px] leading-relaxed text-[var(--text)]">
                    {executive && <p className="font-medium">{executive}</p>}
                    {detailed && detailed !== executive && (
                      <p className="whitespace-pre-wrap text-[var(--text-muted)]">{detailed}</p>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    message={
                      meeting.status === 'processing'
                        ? 'Generating your meeting summary…'
                        : 'No summary yet. Re-run the pipeline after transcription finishes.'
                    }
                  />
                )}
              </ReportCard>

              {topics.length > 0 && (
                <ReportCard title="Topics">
                  <div className="flex flex-wrap gap-2">
                    {topics.map((topic) => (
                      <span
                        key={topic}
                        className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-sm font-medium text-[var(--accent)]"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </ReportCard>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <ReportCard title="Action items" count={meeting.actionItems.length}>
                  <Checklist
                    items={meeting.actionItems.map((a) => ({
                      id: a.id,
                      text: stripThinking(a.text),
                      done: a.completed,
                      meta: a.assignee,
                    }))}
                    empty="No action items detected."
                  />
                </ReportCard>
                <ReportCard title="Key questions" count={meeting.questions.length}>
                  <BulletList
                    items={meeting.questions.map((q) => stripThinking(q.text))}
                    empty="No key questions."
                  />
                </ReportCard>
                <ReportCard title="Decisions" count={meeting.decisions.length}>
                  <BulletList
                    items={meeting.decisions.map((d) => stripThinking(d.text))}
                    empty="No decisions captured."
                  />
                </ReportCard>
                <ReportCard title="Risks" count={meeting.risks.length}>
                  <BulletList
                    items={meeting.risks.map((r) => stripThinking(r.text))}
                    empty="No risks flagged."
                    tone="warning"
                  />
                </ReportCard>
              </div>
            </div>
          )}

          {tab === 'transcript' && (
            <ReportCard title="Full transcript" count={meeting.transcriptSegs.length}>
              {meeting.transcriptSegs.length === 0 ? (
                <EmptyState message="Transcript will appear after Whisper finishes." />
              ) : (
                <div className="space-y-3">
                  {meeting.transcriptSegs.map((seg) => {
                    const active = seg.id === activeSegmentId;
                    return (
                      <div
                        key={seg.id}
                        ref={active ? activeSegRef : undefined}
                        className={`flex cursor-pointer gap-3 rounded-xl px-3 py-3 transition ${
                          active
                            ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/30'
                            : 'hover:bg-[var(--bg-soft)]'
                        }`}
                        onClick={() => seekTo(seg.startMs)}
                      >
                        <SpeakerAvatar label={seg.speakerLabel} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-sm font-semibold">
                              {seg.speakerLabel ?? 'Unknown'}
                            </span>
                            <span className="font-mono text-xs font-medium text-[var(--accent)]">
                              {formatTs(seg.startMs)}
                            </span>
                            {active && (
                              <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                Now
                              </span>
                            )}
                          </div>
                          <p
                            className={`mt-1 text-[15px] leading-relaxed ${
                              active ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {seg.text}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ReportCard>
          )}

          {tab === 'chapters' && (
            <ReportCard
              title="Chapters & timeline"
              count={meeting.timelineEvents?.length ?? 0}
            >
              {(meeting.timelineEvents?.length ?? 0) === 0 ? (
                <EmptyState message="Timeline chapters appear after Phase 2 processing." />
              ) : (
                <ol className="relative space-y-0 border-l-2 border-[var(--accent-soft)] pl-5">
                  {meeting.timelineEvents!.map((ev) => (
                    <li key={ev.id} className="relative pb-6 last:pb-0">
                      <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)] ring-4 ring-[var(--accent-soft)]" />
                      <button
                        type="button"
                        onClick={() => seekTo(ev.timestampMs)}
                        className="font-mono text-xs font-semibold text-[var(--accent)] hover:underline"
                      >
                        {formatTs(ev.timestampMs)}
                      </button>
                      <div className="mt-1 text-sm font-semibold">{ev.label}</div>
                      {ev.description && (
                        <p className="mt-1 text-sm text-[var(--text-muted)]">{ev.description}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </ReportCard>
          )}

          {tab === 'insights' && (
            <div className="space-y-4">
              <ReportCard title="Screen moments" count={meeting.visionAnalyses?.length ?? 0}>
                {(meeting.visionAnalyses?.length ?? 0) === 0 ? (
                  <EmptyState message="Vision insights appear when screenshots are analyzed." />
                ) : (
                  <ul className="space-y-3">
                    {meeting.visionAnalyses!.map((v) => (
                      <li
                        key={v.id}
                        className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)]/60 px-4 py-3"
                      >
                        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                          {v.detectedType ?? 'scene'}
                        </div>
                        <p className="mt-1 text-sm text-[var(--text-muted)]">{v.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </ReportCard>

              <ReportCard title="On-screen text (OCR)" count={meeting.ocrResults?.length ?? 0}>
                {(meeting.ocrResults?.length ?? 0) === 0 ? (
                  <EmptyState message="OCR text will show here after frame analysis." />
                ) : (
                  <div className="space-y-3">
                    {meeting.ocrResults!.map((o) => (
                      <pre
                        key={o.id}
                        className="whitespace-pre-wrap rounded-xl bg-[var(--bg-soft)] px-4 py-3 font-sans text-sm text-[var(--text-muted)]"
                      >
                        {o.text}
                      </pre>
                    ))}
                  </div>
                )}
              </ReportCard>

              <ReportCard title="Pipeline">
                <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
                  {meeting.pipelineJobs.map((job) => (
                    <li key={job.stage} className="bg-white px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="capitalize">{job.stage.replaceAll('_', ' ')}</span>
                        <PipelineStatus status={job.status} />
                      </div>
                      {job.error && (
                        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-[var(--danger)]">
                          {job.error}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              </ReportCard>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ReportCard({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold tracking-tight text-[var(--text)]">{title}</h2>
        {typeof count === 'number' && (
          <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-[var(--text-muted)]">{message}</p>;
}

function BulletList({
  items,
  empty,
  tone,
}: {
  items: string[];
  empty: string;
  tone?: 'warning';
}) {
  if (items.length === 0) return <EmptyState message={empty} />;
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-[var(--text-muted)]">
          <span
            className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
              tone === 'warning' ? 'bg-[var(--warning)]' : 'bg-[var(--accent)]'
            }`}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Checklist({
  items,
  empty,
}: {
  items: Array<{ id: string; text: string; done: boolean; meta?: string | null }>;
  empty: string;
}) {
  if (items.length === 0) return <EmptyState message={empty} />;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 text-sm">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
              item.done
                ? 'border-[var(--success)] bg-emerald-50 text-[var(--success)]'
                : 'border-[var(--border)] bg-white text-transparent'
            }`}
          >
            ✓
          </span>
          <div>
            <div className={item.done ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text)]'}>
              {item.text}
            </div>
            {item.meta && (
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">Owner: {item.meta}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PipelineStatus({ status }: { status: string }) {
  const color =
    status === 'completed'
      ? 'text-[var(--success)]'
      : status === 'failed'
        ? 'text-[var(--danger)]'
        : status === 'running'
          ? 'text-[var(--warning)]'
          : 'text-[var(--text-muted)]';
  return <span className={`text-xs font-semibold capitalize ${color}`}>{status}</span>;
}
