import { speakerColor, speakerInitials } from '../lib/speakers';

export function SpeakerAvatar({
  label,
  size = 'md',
}: {
  label: string | null | undefined;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dim}`}
      style={{ backgroundColor: speakerColor(label) }}
      title={label ?? 'Unknown'}
    >
      {speakerInitials(label)}
    </span>
  );
}
