import { useEffect, useMemo, useState, type RefObject } from 'react';

export type CaptionSegment = {
  id: string;
  startMs: number;
  endMs: number;
  speakerLabel: string | null;
  text: string;
};

type Props = {
  mediaSrc: string;
  segments: CaptionSegment[];
  videoRef: RefObject<HTMLVideoElement | null>;
  onTimeMs?: (ms: number) => void;
  activeSegmentId?: string | null;
};

export function VideoWithCaptions({
  mediaSrc,
  segments,
  videoRef,
  onTimeMs,
}: Props) {
  const [captionsOn, setCaptionsOn] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const vttUrl = useMemo(() => {
    if (segments.length === 0) return null;
    const body = segmentsToVtt(segments);
    const blob = new Blob([body], { type: 'text/vtt' });
    return URL.createObjectURL(blob);
  }, [segments]);

  useEffect(() => {
    return () => {
      if (vttUrl) URL.revokeObjectURL(vttUrl);
    };
  }, [vttUrl]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onTime = () => {
      const ms = el.currentTime * 1000;
      onTimeMs?.(ms);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('seeked', onTime);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('seeked', onTime);
    };
  }, [videoRef, onTimeMs, mediaSrc]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const syncFullscreenAndTracks = () => {
      const fs = isVideoFullscreen(el);
      setIsFullscreen(fs);
      const track = el.textTracks?.[0];
      if (!track) return;
      // Captions only while fullscreen (and user hasn't toggled CC off).
      track.mode = fs && captionsOn ? 'showing' : 'hidden';
    };

    const lockPreviewCaptionsOff = () => {
      if (isVideoFullscreen(el)) return;
      const track = el.textTracks?.[0];
      if (track && track.mode === 'showing') track.mode = 'hidden';
    };

    syncFullscreenAndTracks();
    document.addEventListener('fullscreenchange', syncFullscreenAndTracks);
    el.addEventListener('webkitbeginfullscreen', syncFullscreenAndTracks);
    el.addEventListener('webkitendfullscreen', syncFullscreenAndTracks);
    el.addEventListener('fullscreenchange', syncFullscreenAndTracks);
    el.textTracks?.addEventListener?.('change', lockPreviewCaptionsOff);

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenAndTracks);
      el.removeEventListener('webkitbeginfullscreen', syncFullscreenAndTracks);
      el.removeEventListener('webkitendfullscreen', syncFullscreenAndTracks);
      el.removeEventListener('fullscreenchange', syncFullscreenAndTracks);
      el.textTracks?.removeEventListener?.('change', lockPreviewCaptionsOff);
    };
  }, [videoRef, mediaSrc, captionsOn, vttUrl]);

  return (
    <div className="group relative overflow-hidden rounded-2xl bg-[#0f0e17] shadow-[var(--shadow-md)]">
      <video
        ref={videoRef}
        key={mediaSrc}
        src={mediaSrc}
        controls
        className="aspect-video w-full bg-black"
        preload="metadata"
        crossOrigin="anonymous"
      >
        {vttUrl && (
          <track
            kind="captions"
            srcLang="en"
            label="Transcript"
            src={vttUrl}
            default
          />
        )}
      </video>

      {segments.length > 0 && (
        <div className="absolute right-3 top-3 z-10 flex gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => setCaptionsOn((v) => !v)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-md backdrop-blur-sm transition ${
              captionsOn
                ? 'bg-[var(--accent)] text-white'
                : 'bg-black/55 text-white/80 hover:bg-black/70'
            }`}
            title={
              captionsOn
                ? 'Captions on in fullscreen'
                : 'Captions off'
            }
          >
            CC
          </button>
        </div>
      )}

      {!isFullscreen && segments.length > 0 && (
        <p className="pointer-events-none absolute bottom-12 left-1/2 z-[5] hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-black/50 px-2 py-1 text-[10px] text-white/70 group-hover:block">
          Captions appear in fullscreen
        </p>
      )}
    </div>
  );
}

function isVideoFullscreen(el: HTMLVideoElement): boolean {
  const docFs = document.fullscreenElement;
  if (docFs === el) return true;
  // Wrapper fullscreen (if used later)
  if (docFs && docFs.contains(el)) return true;
  const webkit = el as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean };
  return Boolean(webkit.webkitDisplayingFullscreen);
}

function segmentsToVtt(segments: CaptionSegment[]): string {
  const cues = segments.map((seg, i) => {
    const start = msToVtt(seg.startMs);
    // Ensure cue has a minimum duration so it remains visible.
    const endMs = Math.max(seg.endMs, seg.startMs + 800);
    const end = msToVtt(endMs);
    const speaker = seg.speakerLabel?.trim() || 'Speaker';
    const text = `${speaker}: ${seg.text.trim()}`.replace(/\n+/g, ' ');
    return `${i + 1}\n${start} --> ${end}\n${text}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function msToVtt(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const frac = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(frac, 3)}`;
}

function pad(n: number, width = 2): string {
  return n.toString().padStart(width, '0');
}

export function findActiveSegmentId(
  segments: CaptionSegment[],
  currentMs: number,
): string | null {
  const hit = segments.find((s) => currentMs >= s.startMs && currentMs < s.endMs);
  return hit?.id ?? null;
}
