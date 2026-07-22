import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type CaptureSource = {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  kind?: 'screen' | 'window';
};

export function RecordPage() {
  const navigate = useNavigate();
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const micTracksRef = useRef<MediaStreamTrack[]>([]);
  const timerRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        if (window.meetingMind) {
          const list = await window.meetingMind.listCaptureSources();
          setSources(list);
          const preferred =
            list.find((s) => s.kind === 'screen' || s.id.startsWith('screen:')) ?? list[0];
          if (preferred) {
            setSelectedSourceId(preferred.id);
            await window.meetingMind.setPreferredCaptureSource(preferred.id);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      stopTracks();
      if (timerRef.current) window.clearInterval(timerRef.current);
      void window.meetingMind?.hideRecordingBar?.();
    };
  }, []);

  useEffect(() => {
    if (!window.meetingMind?.onRecordingCommand) return;
    return window.meetingMind.onRecordingCommand((command) => {
      if (command === 'toggle-pause') void togglePause();
      if (command === 'toggle-mute') toggleMute();
      if (command === 'stop') void stopRecording();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, paused, muted, meetingId]);

  useEffect(() => {
    if (!recording || !window.meetingMind?.updateRecordingBar) return;
    void window.meetingMind.updateRecordingBar({ elapsed, paused, muted });
  }, [elapsed, paused, muted, recording]);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    micTracksRef.current = [];
  }

  async function selectSource(source: CaptureSource) {
    setSelectedSourceId(source.id);
    try {
      await window.meetingMind?.setPreferredCaptureSource?.(source.id);
      // Bring that app/window to the front (e.g. ChatGPT), or open it if needed.
      await window.meetingMind?.focusCaptureSource?.({
        id: source.id,
        name: source.name,
      });
    } catch {
      // browser preview
    }
  }

  async function startRecording() {
    setError(null);
    stoppingRef.current = false;
    try {
      if (selectedSourceId && window.meetingMind?.setPreferredCaptureSource) {
        await window.meetingMind.setPreferredCaptureSource(selectedSourceId);
      }

      const meeting = await api.createMeeting({
        title: `Recording ${new Date().toLocaleString()}`,
        platform: 'unknown',
      });
      setMeetingId(meeting.id);
      await api.startRecording(meeting.id);

      // Prefer Electron desktopCapturer source (includes MeetingMind when capturing a screen).
      let displayStream: MediaStream;
      if (selectedSourceId && window.meetingMind) {
        displayStream = await captureDesktopSource(selectedSourceId);
      } else {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
      }

      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        micTracksRef.current = micStream.getAudioTracks();
      } catch {
        micTracksRef.current = [];
      }

      const tracks = [
        ...displayStream.getVideoTracks(),
        ...displayStream.getAudioTracks(),
        ...micTracksRef.current,
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
      setPaused(false);
      setMuted(false);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);

      await window.meetingMind?.showRecordingBar?.({
        elapsed: 0,
        paused: false,
        muted: false,
      });
      // Keep floating controls visible while you work in other apps.
      await window.meetingMind?.minimizeMain?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRecording(false);
      void window.meetingMind?.hideRecordingBar?.();
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    for (const track of micTracksRef.current) {
      track.enabled = !next;
    }
  }

  function togglePause() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    if (recorder.state === 'recording') {
      recorder.pause();
      setPaused(true);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } else if (recorder.state === 'paused') {
      recorder.resume();
      setPaused(false);
      if (!timerRef.current) {
        timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
      }
    }
  }

  async function stopRecording() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    const recorder = mediaRecorderRef.current;
    const id = meetingId;
    if (!recorder || !id) {
      stoppingRef.current = false;
      return;
    }

    setError(null);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        if (recorder.state === 'paused') recorder.resume();
      } catch {
        // ignore
      }
      recorder.stop();
    });
    stopTracks();
    setRecording(false);
    setPaused(false);
    void window.meetingMind?.hideRecordingBar?.();
    void window.meetingMind?.recordingCommand?.('show-app');

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
    } finally {
      stoppingRef.current = false;
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Record a meeting</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Pick a <strong>screen</strong> to include MeetingMind itself, or a window card to select
        and open that app (e.g. ChatGPT). The floating toolbar stays on top and is{' '}
        <strong>visible in your recording</strong>.
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
            onClick={() => void selectSource(source)}
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
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="truncate text-xs text-[var(--text-muted)]">{source.name}</div>
              <span className="shrink-0 rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                {source.kind === 'screen' || source.id.startsWith('screen:') ? 'Screen' : 'Window'}
              </span>
            </div>
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
        <div className="font-mono text-2xl font-semibold tabular-nums">
          {formatElapsed(elapsed)}
          {paused ? <span className="ml-2 text-sm text-amber-600">paused</span> : null}
        </div>
        {!recording ? (
          <button
            type="button"
            onClick={() => void startRecording()}
            className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
          >
            Start recording
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => togglePause()}
              className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:border-[var(--accent)]"
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => toggleMute()}
              className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:border-[var(--accent)]"
            >
              {muted ? 'Unmute mic' : 'Mute mic'}
            </button>
            <button
              type="button"
              onClick={() => void stopRecording()}
              className="rounded-xl bg-[var(--danger)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
            >
              Stop & process
            </button>
          </>
        )}
        {meetingId && (
          <span className="text-xs text-[var(--text-muted)]">Meeting {meetingId}</span>
        )}
      </div>

      {recording && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Floating toolbar stays on top and appears in the recording. Press <strong>Stop</strong>{' '}
          when finished. Use a full <strong>Screen</strong> source to include MeetingMind in the
          video.
        </p>
      )}
    </div>
  );
}

/**
 * Capture a specific desktopCapturer source (screen or window), including MeetingMind
 * when the chosen source is a full display.
 */
async function captureDesktopSource(sourceId: string): Promise<MediaStream> {
  // Electron Chrome desktop capture constraints.
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    },
  } as unknown as MediaStreamConstraints;

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    // Fallback: getDisplayMedia uses the preferred source set in main process.
    return navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  }
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
