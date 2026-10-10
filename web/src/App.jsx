import React, { useState } from 'react';
import StudentView from './views/StudentView.jsx';
import ReferrerView from './views/ReferrerView.jsx';
import TrackView from './views/TrackView.jsx';
import ShieldView from './views/ShieldView.jsx';
import EmployerView from './views/EmployerView.jsx';
import DiscoverView from './views/DiscoverView.jsx';
import { api } from './api.js';

const TABS = [
  { id: 'student', label: 'Student', icon: '◆', hint: 'Ask for a referral' },
  { id: 'track', label: 'My referrals', icon: '≡', hint: 'Track sent packets' },
  { id: 'referrer', label: 'Referrer', icon: '◇', hint: 'Review packets' },
  { id: 'discover', label: 'Office hours', icon: '◷', hint: 'Who is open' },
  { id: 'shield', label: 'Shield', icon: '🛡', hint: 'Inbound messages' },
  { id: 'employer', label: 'Employer', icon: '▤', hint: 'Trust dashboard' },
];

export default function App() {
  const [tab, setTab] = useState('student');
  // Two separate counters on purpose. `refreshKey` tells sibling views their
  // data is stale; `resetKey` force-remounts everything. Using one for both
  // would blow away the "packet sent" confirmation the instant it appears.
  const [refreshKey, setRefreshKey] = useState(0);
  const [resetKey, setResetKey] = useState(0);

  async function reset() {
    await api.reset();
    setResetKey((k) => k + 1);
    setRefreshKey((k) => k + 1);
    setTab('student');
  }

  return (
    <>
      <div className="banner-demo">
        <strong>Prototype.</strong> Every score below is computed live by the Vouch Trust Engine against seeded data —
        nothing here is hard-coded. Companies are fictional.
      </div>

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">V</span>
            <span>
              Vouch
              <span className="brand-sub" style={{ display: 'block', marginTop: -3 }}>
                Verified referrals &amp; hiring trust
              </span>
            </span>
          </div>
          <nav className="nav">
            {TABS.map((t) => (
              <button key={t.id} aria-current={tab === t.id} onClick={() => setTab(t.id)} title={t.hint}>
                <span aria-hidden>{t.icon}</span>
                {t.label}
              </button>
            ))}
            <button onClick={reset} title="Restore seed data">↺</button>
          </nav>
        </div>
      </header>

      <main className="page" key={resetKey}>
        {tab === 'student' && <StudentView onSent={() => setRefreshKey((k) => k + 1)} />}
        {tab === 'track' && <TrackView refreshKey={refreshKey} />}
        {tab === 'referrer' && <ReferrerView refreshKey={refreshKey} />}
        {tab === 'discover' && <DiscoverView />}
        {tab === 'shield' && <ShieldView />}
        {tab === 'employer' && <EmployerView />}
      </main>
    </>
  );
}
