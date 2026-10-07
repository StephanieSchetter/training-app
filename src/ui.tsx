// Shared building blocks so every screen looks and behaves the same way.
import { ReactNode, useEffect, useState } from 'react';

const PATHS: Record<string, string> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  flag: 'M6 21V4h11l-2 4 2 4H6',
  note: 'M5 4h14v12l-4 4H5zM9 9h6M9 13h4',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  bar: 'M4 12h16M7 8v8M17 8v8M4 10v4M20 10v4',
  run: 'M13 5a1.5 1.5 0 100-.01M9 20l2-5-2-3 3-4 3 3h3M7 12l2-3',
  cloud: 'M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18z',
  info: 'M12 11v6M12 7.5v.01M12 3a9 9 0 100 18 9 9 0 000-18z',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  cal: 'M5 6h14v14H5zM5 10h14M9 3v4M15 3v4',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  trash:'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Slide-up panel for secondary choices; tap outside to close. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** The fixed bottom area: the main action always sits under the thumb. */
export function Dock({ children }: { children: ReactNode }) {
  return <div className="dock"><div className="dock-in">{children}</div></div>;
}

export function AppBar({ title, sub, left, right }: { title: string; sub?: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="appbar">
      <div className="appbar-side">{left}</div>
      <div className="appbar-mid">
        <div className="appbar-title">{title}</div>
        {sub && <div className="appbar-sub">{sub}</div>}
      </div>
      <div className="appbar-side end">{right}</div>
    </header>
  );
}

export function Stepper({ label, unit, value, onMinus, onPlus, onType }: {
  label: string; unit: string; value: number | string | null; onMinus: () => void; onPlus: () => void; onType?: (v: number | null) => void;
}) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="stepper">
        <button aria-label={`Less ${label}`} onClick={onMinus}><Icon name="minus" size={28} /></button>
        <label>
          {onType
            ? <input inputMode="decimal" value={value ?? ''} placeholder="—" onChange={e => onType(e.target.value === '' ? null : Number(e.target.value))} />
            : <div className="num">{value}</div>}
          <span>{unit}</span>
        </label>
        <button aria-label={`More ${label}`} onClick={onPlus}><Icon name="plus" size={28} /></button>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T | null; onChange: (v: T | null) => void;
}) {
  return (
    <div className="seg" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map(o => (
        <button key={String(o.value)} className={value === o.value ? 'on' : ''} onClick={() => onChange(value === o.value ? null : o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <>{s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : clock(s)}</>;
}
