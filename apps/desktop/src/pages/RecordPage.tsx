import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type CaptureSource = {
  id: string;
  name: string;
  thumbnailDataUrl: string;
};

export function RecordPage() {
  const navigate = useNavigate();
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        if (window.meetingMind) {
          const list = await window.meetingMind.listCaptureSources();
          setSources(list);
          if (list[0]) setSelectedSourceId(list[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      stopTracks();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function startRecording() {
    setError(null);
    try {
      const meeting = await api.createMeeting({
        title: `Recording ${new Date().toLocaleString()}`,
        platform: 'unknown',
      });
      setMeetingId(meeting.id);
      await api.startRecording(meeting.id);

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch {
        // Mic optional for MVP if permission denied.
      }

      const tracks = [
        ...displayStream.getVideoTracks(),
        ...displayStream.getAudioTracks(),
        ...(micStream?.getAudioTracks() ?? []),
      ];
      const combined = new MediaStream(tracks);
      streamRef.current = combined;

      chunksRef.current = [];
      const recorder = new MediaRecorder(combined, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : 'video/webm',
      });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(1000);
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRecording(false);
    }
  }

  async function stopRecording() {
    const recorder = mediaRecorderRef.current;
    const id = meetingId;
    if (!recorder || !id) return;

    setError(null);
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    if (timerRef.current) window.clearInterval(timerRef.current);
    stopTracks();
    setRecording(false);

    try {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      if (blob.size === 0) {
        throw new Error('Recording produced an empty file. Try again.');
      }
      await api.attachRecording(id, blob, 'recording.webm');
      navigate(`/meetings/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      try {
        await api.endMeeting(id);
        navigate(`/meetings/${id}`);
      } catch {
        // keep error from upload
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Record a meeting</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Capture screen, system audio, and microphone. Processing starts after you stop.
      </p>

      {error && (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map((source) => (
          <button
            key={source.id}
            type="button"
            disabled={recording}
            onClick={() => setSelectedSourceId(source.id)}
            className={`overflow-hidden rounded-2xl border bg-white text-left shadow-[var(--shadow-sm)] transition ${
              selectedSourceId === source.id
                ? 'border-[var(--accent)] ring-2 ring-[var(--accent-soft)]'
                : 'border-[var(--border)] hover:border-[var(--accent)]'
            }`}
          >
            <img
              src={source.thumbnailDataUrl}
              alt={source.name}
              className="aspect-video w-full bg-black object-cover"
            />
            <div className="truncate px-3 py-2 text-xs text-[var(--text-muted)]">{source.name}</div>
          </button>
        ))}
        {sources.length === 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-8 text-sm text-[var(--text-muted)] shadow-[var(--shadow-sm)] sm:col-span-2 lg:col-span-3">
            Capture sources appear when running inside Electron. Browser preview can still start a
            display capture via the system picker.
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--border)] bg-white px-5 py-4 shadow-[var(--shadow-sm)]">
        <div className="font-mono text-2xl font-semibold tabular-nums">{formatElapsed(elapsed)}</div>
        {!recording ? (
          <button
            type="button"
            onClick={() => void startRecording()}
            className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
          >
            Start recording
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void stopRecording()}
            className="rounded-xl bg-[var(--danger)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
          >
            Stop & process
          </button>
        )}
        {meetingId && (
          <span className="text-xs text-[var(--text-muted)]">Meeting {meetingId}</span>
        )}
      </div>
    </div>
  );
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
