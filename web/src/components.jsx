import React from 'react';

export const initials = (name = '?') =>
  name
    .replace(/[^a-zA-Z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';

export function Avatar({ name, small, scam }) {
  return (
    <div className={`avatar ${small ? 'avatar-sm' : ''} ${scam ? 'avatar-scam' : ''}`}>{initials(name)}</div>
  );
}

export function Card({ title, subtitle, right, children, foot, pad = true }) {
  return (
    <section className="card">
      {(title || right) && (
        <header className="card-head">
          <div style={{ minWidth: 0 }}>
            {title && <h3>{title}</h3>}
            {subtitle && <p className="tiny muted" style={{ marginTop: 2 }}>{subtitle}</p>}
          </div>
          <div className="spacer" />
          {right}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
      {foot && <div className="card-foot">{foot}</div>}
    </section>
  );
}

export function Pill({ tone = '', children }) {
  return <span className={`pill ${tone ? `pill-${tone}` : ''}`}>{children}</span>;
}

/** Circular score readout. Colour encodes band, never the raw number alone. */
export function Ring({ value, size = 72, tone = 'blue', label }) {
  const stroke = size >= 60 ? 7 : 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const colours = {
    blue: 'var(--blue)', green: 'var(--green)', amber: 'var(--amber)',
    red: 'var(--red)', grey: 'var(--ink-3)', purple: 'var(--purple)',
  };
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-soft)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={colours[tone]} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * Math.max(0, Math.min(100, value))) / 100}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="ring-val" style={{ fontSize: size / 3.1, color: colours[tone] }}>
        {value}
        {label && <div style={{ fontSize: 9, letterSpacing: '0.06em', color: 'var(--ink-3)' }}>{label}</div>}
      </div>
    </div>
  );
}

export function Meter({ label, value, weight, tone = 'blue' }) {
  const colours = { blue: 'var(--blue)', green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };
  return (
    <div className="meter">
      <span className="meter-label">
        {label}
        {weight != null && <span className="dim"> · {Math.round(weight * 100)}% of score</span>}
      </span>
      <span className="meter-val">{Math.round(value * 100)}%</span>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.round(value * 100)}%`, background: colours[tone] }} />
      </div>
    </div>
  );
}

export function Reason({ kind = 'neutral', children }) {
  return (
    <div className={`reason reason-${kind}`}>
      <span className="reason-dot" />
      <span>{children}</span>
    </div>
  );
}

export function Alert({ tone = 'blue', icon, title, children, actions }) {
  return (
    <div className={`alert alert-${tone}`}>
      {icon && <span className="alert-icon">{icon}</span>}
      <div style={{ minWidth: 0, flex: 1 }}>
        {title && <div className="alert-title">{title}</div>}
        <div className="tiny" style={{ color: 'var(--ink-2)' }}>{children}</div>
        {actions && <div className="row-wrap" style={{ marginTop: 10 }}>{actions}</div>}
      </div>
    </div>
  );
}

export function Switch({ on, onChange, children }) {
  return (
    <label className="switch">
      <span className="switch-track" data-on={String(!!on)} onClick={() => onChange(!on)} role="switch" aria-checked={!!on}>
        <span className="switch-knob" />
      </span>
      <span>{children}</span>
    </label>
  );
}

export function Stat({ num, label, tone }) {
  const colours = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)', blue: 'var(--blue)' };
  return (
    <div className="stat">
      <div className="stat-num" style={{ color: colours[tone] ?? 'var(--ink)' }}>{num}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/** Tone lookups shared across views so bands render consistently everywhere. */
export const fitTone = (band) => ({ strong: 'green', viable: 'blue', stretch: 'amber', weak: 'red' }[band] ?? 'grey');
export const riskTone = (band) => ({ clear: 'green', low: 'blue', caution: 'amber', high: 'red' }[band] ?? 'grey');
export const livenessTone = (band) => ({ active: 'green', slow: 'amber', stale: 'red' }[band] ?? 'grey');
export const credTone = (tier) =>
  ({ trusted: 'green', reliable: 'blue', mixed: 'amber', low: 'red', establishing: 'grey' }[tier] ?? 'grey');

export const inr = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`;

export const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};
