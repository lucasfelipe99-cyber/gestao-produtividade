import React, { useState } from 'react';
import { initials, colorFor, STATUS, PRIORITY } from './lib.js';

const P = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  dashboard: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
  today: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4',
  week: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8M20 16v-3',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.5a4 4 0 0 1 0 7M18 14a6 6 0 0 1 4 6v1',
  menu: 'M4 6h16M4 12h16M4 18h16',
  timeline: 'M3 6h8M7 12h11M5 18h7M3 3v18',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  down: 'M5 9l7 7 7-7',
  key: 'M14 10a4 4 0 1 0-3.5 4L9 15.5V18H6.5v2.5H4V18l6.5-6.5',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  kanban: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  note: 'M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5',
  stop: 'M6 6h12v12H6z',
  share: 'M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10.6 13.5l2.8 1.8M13.4 6.7l-2.8 1.8',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
};

export function Icon({ name, size = 18 }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name] || ''} fill={name === 'play' ? 'currentColor' : 'none'} />
    </svg>
  );
}

export function Avatar({ name, id, size = 28 }) {
  if (!name) return <span className="avatar empty" style={{ width: size, height: size }} title="Sem responsável">?</span>;
  return <span className="avatar" title={name} style={{ background: colorFor(id), width: size, height: size, fontSize: size * 0.4 }}>{initials(name)}</span>;
}

export function Modal({ title, children, onClose, footer, wide }) {
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small className="muted">{hint}</small>}</label>
);

export function Pill({ color, children, onClick, className = '' }) {
  return <span className={'pill ' + className} style={{ background: color }} onClick={onClick}>{children}</span>;
}

export function StatusPill({ status, onChange, options }) {
  const [open, setOpen] = useState(false);
  const s = STATUS[status] || STATUS.not_started;
  if (!onChange) return <Pill color={s.color}>{s.label}</Pill>;
  return (
    <span className="pill-select">
      <Pill color={s.color} className="clickable" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{s.label}</Pill>
      {open && (
        <>
          <div className="click-away" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="dropdown pill-menu" onClick={(e) => e.stopPropagation()}>
            {(options || Object.keys(STATUS)).map((k) => (
              <button key={k} className="pill" style={{ background: STATUS[k].color }} onClick={() => { setOpen(false); if (k !== status) onChange(k); }}>{STATUS[k].label}</button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

export const PriorityPill = ({ priority }) => <Pill color={PRIORITY[priority]?.color}>{PRIORITY[priority]?.label}</Pill>;

export function Progress({ value, color, height = 8, label }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="progress-row">
      <div className="progress" style={{ height }}><div style={{ width: v + '%', background: color || '#00c875' }} /></div>
      {label !== false && <span className="progress-label">{label ?? `${Math.round(v)}%`}</span>}
    </div>
  );
}

export function Kpi({ label, value, sub, color, icon }) {
  return (
    <div className="kpi" style={{ '--kpi': color || '#0073ea' }}>
      <div className="kpi-top"><span>{label}</span>{icon && <Icon name={icon} size={16} />}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented">
      {options.map(([v, label, icon]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{icon && <Icon name={icon} size={15} />}{label}</button>
      ))}
    </div>
  );
}

export const Empty = ({ children }) => <div className="empty">{children}</div>;
export const Loading = () => <div className="loading"><div className="spinner" /></div>;

export function Card({ title, children, actions, className = '' }) {
  return (
    <section className={'card ' + className}>
      {(title || actions) && <div className="card-head"><h3>{title}</h3><div className="row gap">{actions}</div></div>}
      {children}
    </section>
  );
}
