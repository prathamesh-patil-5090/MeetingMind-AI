import { NavLink, Outlet } from 'react-router-dom';

const navItem = ({ isActive }: { isActive: boolean }) =>
  [
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
    isActive
      ? 'bg-white/12 text-white'
      : 'text-white/65 hover:bg-white/8 hover:text-white',
  ].join(' ');

export function AppShell() {
  return (
    <div className="flex h-full min-h-0 bg-[var(--bg)]">
      <aside className="flex w-[240px] shrink-0 flex-col bg-[var(--bg-sidebar)] text-white">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-sm font-extrabold tracking-tight">
            M
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-tight">MeetingMind</div>
            <div className="truncate text-[11px] text-white/50">Meeting reports</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 pt-2">
          <NavLink to="/" className={navItem} end>
            <NavIcon kind="library" />
            Meetings
          </NavLink>
          <NavLink to="/ask" className={navItem}>
            <NavIcon kind="ask" />
            Ask Knowledge
          </NavLink>
          <NavLink to="/record" className={navItem}>
            <NavIcon kind="record" />
            Record
          </NavLink>
          <NavLink to="/import" className={navItem}>
            <NavIcon kind="import" />
            Upload
          </NavLink>
        </nav>

        <div className="border-t border-white/10 px-5 py-4 text-[11px] text-white/40">
          Local-first knowledge engine
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function NavIcon({ kind }: { kind: 'library' | 'record' | 'import' | 'ask' }) {
  if (kind === 'library') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v12.5a1.5 1.5 0 0 1-1.5 1.5H7A3 3 0 0 1 4 17V6.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path d="M8 8h8M8 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'ask') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 12a7 7 0 1 1 3.2 5.8L5 19l.8-3.1A6.9 6.9 0 0 1 5 12Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M9.5 11.5h5M9.5 14h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'record') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="3.25" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v10m0 0 3.5-3.5M12 14l-3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
