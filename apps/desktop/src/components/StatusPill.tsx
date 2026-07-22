import { statusLabel } from '../lib/text';

const STYLES: Record<string, string> = {
  ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  processing: 'bg-amber-50 text-amber-700 ring-amber-200',
  recording: 'bg-rose-50 text-rose-700 ring-rose-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
};

export function StatusPill({ status }: { status: string }) {
  const style = STYLES[status] ?? 'bg-slate-100 text-slate-600 ring-slate-200';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {status === 'processing' && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {statusLabel(status)}
    </span>
  );
}
