import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type KnowledgeCitation } from '../lib/api';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: KnowledgeCitation[];
};

const SUGGESTIONS = [
  'What decisions were made across recent meetings?',
  'List open action items I still need to finish',
  'What risks keep coming up?',
  'Summarize themes from the last few meetings',
];

export function AskPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    setError(null);
    setInput('');
    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: q,
    };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);

    try {
      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const result = await api.askKnowledge({ question: q, history });
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: result.answer,
          citations: result.citations,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-3xl flex-col px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Ask Knowledge</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Search across all meeting reports, summaries, decisions, and action items.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--border)] bg-white shadow-[var(--shadow-sm)]">
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.length === 0 && !busy && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--text-muted)]">Try one of these:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-left text-xs font-medium text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-soft)] text-[var(--text)]'
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.citations && m.citations.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-black/5 pt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Sources
                    </div>
                    {m.citations.map((c, i) => (
                      <Link
                        key={`${c.meetingId}-${c.source}-${i}`}
                        to={`/meetings/${c.meetingId}`}
                        className="block rounded-xl bg-white/80 px-3 py-2 transition hover:ring-1 hover:ring-[var(--accent)]"
                      >
                        <div className="text-xs font-semibold text-[var(--accent)]">
                          {c.meetingTitle}
                          <span className="ml-2 font-medium uppercase text-[var(--text-muted)]">
                            {c.source.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">
                          {c.snippet}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="text-sm text-[var(--text-muted)]">Searching your meeting knowledge…</div>
          )}
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="border-t border-[var(--border)] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder="Ask across all your meetings…"
              className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              Ask
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
