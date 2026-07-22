const PALETTE = [
  '#6B4EFF',
  '#0EA5A4',
  '#F59E0B',
  '#EC4899',
  '#3B82F6',
  '#10B981',
  '#F97316',
  '#8B5CF6',
];

export function speakerColor(label: string | null | undefined): string {
  const key = (label ?? 'Unknown').trim().toLowerCase() || 'unknown';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length]!;
}

export function speakerInitials(label: string | null | undefined): string {
  const parts = (label ?? 'U').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}
