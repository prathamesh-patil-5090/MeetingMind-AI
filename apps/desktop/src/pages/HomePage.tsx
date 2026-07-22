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
            <Link
              key={m.id}
              to={`/meetings/${m.id}`}
              className="group flex gap-4 rounded-2xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-sm)] transition hover:border-[var(--accent)] hover:shadow-[var(--shadow-md)]"
            >
              <div className="flex h-[72px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#6b4eff] to-[#2a2150] text-white/80">
                <span className="text-lg">▶</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[var(--text)] group-hover:text-[var(--accent)]">
                      {m.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                      <StatusPill status={m.status} />
                      <span>{formatMeetingDate(m.startedAt)}</span>
                      {m.durationSeconds != null && (
                        <span>{formatDuration(m.durationSeconds)}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-[var(--text-muted)]">
                    <div>{m._count?.transcriptSegs ?? 0} segments</div>
                    <div>{m._count?.actionItems ?? 0} actions</div>
                  </div>
                </div>
                {m.summary?.executive && (
                  <p className="mt-2 line-clamp-2 text-sm text-[var(--text-muted)]">
                    {stripThinking(m.summary.executive)}
                  </p>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-14 text-center text-sm text-[var(--text-muted)]">
      {children}
    </div>
  );
}
