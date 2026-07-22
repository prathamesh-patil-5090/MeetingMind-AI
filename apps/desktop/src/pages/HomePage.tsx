import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StatusPill } from '../components/StatusPill';
import { api, type MeetingListItem } from '../lib/api';
import { formatDuration, formatMeetingDate, stripThinking } from '../lib/text';

type SearchHit = {
  meetingId: string;
  meetingTitle: string;
  snippet: string;
  score: number;
  source: string;
};

export function HomePage() {
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function refresh(q?: string) {
    try {
      setError(null);
      await api
        .health()
        .then(() => setApiOk(true))
        .catch(() => setApiOk(false));
      const term = q?.trim() ?? '';
      if (term) {
        const semantic = await api.search(term);
        setHits(semantic);
        setMeetings([]);
      } else {
        setHits(null);
        setMeetings(await api.listMeetings());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteMeeting(id: string, title: string) {
    const ok = window.confirm(
      `Delete “${title}”?\n\nThis removes the report, transcript, and local recording files.`,
    );
    if (!ok) return;
    setDeletingId(id);
    try {
      await api.deleteMeeting(id);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      setHits((prev) => (prev ? prev.filter((h) => h.meetingId !== id) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--text)]">Meetings</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Your meeting reports — summaries, transcripts, and action items.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/import"
            className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Upload
          </Link>
          <Link
            to="/record"
            className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition hover:bg-[var(--accent-hover)]"
          >
            New recording
          </Link>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void refresh(query);
            }}
            placeholder="Search meetings, decisions, topics…"
            className="w-full rounded-xl border border-[var(--border)] bg-white py-2.5 pl-4 pr-4 text-sm shadow-[var(--shadow-sm)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
          />
        </div>
        <button
          type="button"
          onClick={() => void refresh(query)}
          className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text-muted)] shadow-[var(--shadow-sm)] hover:text-[var(--text)]"
        >
          Search
        </button>
        <span
          className={`text-xs font-medium ${
            apiOk
              ? 'text-[var(--success)]'
              : apiOk === false
                ? 'text-[var(--danger)]'
                : 'text-[var(--text-muted)]'
          }`}
        >
          API {apiOk === null ? '…' : apiOk ? 'online' : 'offline'}
        </span>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <div className="mt-1 text-rose-500">
            Start the local API with <code className="font-semibold">pnpm dev:api</code>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-3">
        {hits ? (
          hits.length === 0 ? (
            <EmptyCard>No semantic matches.</EmptyCard>
          ) : (
            hits.map((hit) => (
              <Link
                key={`${hit.meetingId}-${hit.source}-${hit.snippet.slice(0, 24)}`}
                to={`/meetings/${hit.meetingId}`}
                className="block rounded-2xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-sm)] transition hover:border-[var(--accent)] hover:shadow-[var(--shadow-md)]"
              >
                <div className="font-semibold text-[var(--text)]">{hit.meetingTitle}</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {hit.source} · score {hit.score.toFixed(3)}
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-[var(--text-muted)]">{hit.snippet}</p>
              </Link>
            ))
          )
        ) : meetings.length === 0 && !error ? (
          <EmptyCard>
            No meetings yet. Record or upload one to generate your first report.
          </EmptyCard>
        ) : (
          meetings.map((m) => (
            <article
              key={m.id}
              className="flex items-stretch gap-4 rounded-2xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-sm)] transition hover:border-[var(--accent)]/40 hover:shadow-[var(--shadow-md)]"
            >
              <Link
                to={`/meetings/${m.id}`}
                className="flex min-w-0 flex-1 gap-4 outline-none"
              >
                <div className="flex h-[72px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#6b4eff] to-[#2a2150] text-white/85">
                  <span className="text-lg" aria-hidden>
                    ▶
                  </span>
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <h2 className="truncate text-[15px] font-semibold text-[var(--text)] hover:text-[var(--accent)]">
                    {m.title}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    <StatusPill status={m.status} />
                    <span>{formatMeetingDate(m.startedAt)}</span>
                    {m.durationSeconds != null && (
                      <>
                        <span className="text-[var(--border)]">·</span>
                        <span>{formatDuration(m.durationSeconds)}</span>
                      </>
                    )}
                    <span className="text-[var(--border)]">·</span>
                    <span>
                      {m._count?.transcriptSegs ?? 0} segments · {m._count?.actionItems ?? 0}{' '}
                      actions
                    </span>
                  </div>
                  {m.summary?.executive && (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--text-muted)]">
                      {stripThinking(m.summary.executive)}
                    </p>
                  )}
                </div>
              </Link>

              <div className="flex shrink-0 flex-col items-end justify-between py-0.5">
                <button
                  type="button"
                  title="Delete meeting"
                  aria-label={`Delete ${m.title}`}
                  disabled={deletingId === m.id}
                  onClick={() => void deleteMeeting(m.id, m.title)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  {deletingId === m.id ? (
                    <span className="text-xs font-semibold">…</span>
                  ) : (
                    <TrashIcon />
                  )}
                </button>
                <Link
                  to={`/meetings/${m.id}`}
                  className="text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  Open →
                </Link>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-14 text-center text-sm text-[var(--text-muted)]">
      {children}
    </div>
  );
}
