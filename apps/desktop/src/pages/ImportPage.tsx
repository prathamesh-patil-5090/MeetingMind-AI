import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const ACCEPT =
  '.mp4,.webm,.mkv,.mov,.mp3,.wav,.m4a,.ogg,.flac,.mpeg,video/*,audio/*';

export function ImportPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFile(next: File | null) {
    setError(null);
    setFile(next);
    if (next && !title.trim()) {
      const base = next.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      setTitle(base);
    }
  }

  async function onSubmit() {
    if (!file) {
      setError('Choose a video or audio file first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meeting = await api.importMeeting(file, title.trim() || undefined);
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Upload recording</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Drop in a meeting video or audio — we generate the same report with transcript, summary, and
        action items.
      </p>

      {error && (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = e.dataTransfer.files?.[0] ?? null;
          pickFile(dropped);
        }}
        className={`mt-6 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${
          dragOver
            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
            : 'border-[var(--border)] bg-white shadow-[var(--shadow-sm)]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-sm font-semibold text-[var(--text)]">
          {file ? file.name : 'Drag & drop your recording'}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">MP4, WebM, MOV, MP3, WAV, and more</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          Choose file
        </button>
      </div>

      <label className="mt-5 block text-sm font-medium text-[var(--text)]">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Optional meeting title"
          className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm shadow-[var(--shadow-sm)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
        />
      </label>

      <button
        type="button"
        disabled={busy || !file}
        onClick={() => void onSubmit()}
        className="mt-5 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        {busy ? 'Uploading…' : 'Generate report'}
      </button>
    </div>
  );
}
