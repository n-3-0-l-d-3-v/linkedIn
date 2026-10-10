import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Avatar, Card, Empty, Pill, Ring, credTone } from '../components.jsx';

/**
 * Referral Office Hours — the supply-side inversion.
 *
 * Today referral supply is invisible: a student has no way to know which
 * employees are willing to review a packet this month, so the only strategy is
 * cold-DM everyone and hope. That is the behaviour that trains employees to
 * mute the channel entirely.
 *
 * Making willingness declarable and searchable turns a scarce, hidden resource
 * into an allocated one — and it costs the employee nothing except a toggle.
 */
export default function DiscoverView() {
  const [hosts, setHosts] = useState(null);

  useEffect(() => { api.officeHours().then(setHosts); }, []);

  if (!hosts) return <Card><Empty>Loading…</Empty></Card>;

  return (
    <div className="stack">
      <Card title="Referral office hours" subtitle="Employees who have opted in to review packets this cycle">
        {hosts.length === 0 ? (
          <Empty>Nobody has office hours open right now.</Empty>
        ) : (
          <div className="grid-2">
            {hosts.map((h) => (
              <div className="artifact" key={h.id}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <Avatar name={h.name} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ fontSize: 13.5 }}>{h.name}</strong>
                    <div className="tiny muted">{h.title}</div>
                    <div className="tiny dim">{h.company} · {h.team}</div>
                    <div className="row-wrap" style={{ marginTop: 7 }}>
                      <Pill tone={h.slotsLeft > 0 ? 'green' : 'red'}>
                        {h.slotsLeft} slot{h.slotsLeft === 1 ? '' : 's'} left
                      </Pill>
                      <Pill tone={credTone(h.credibility.tier)}>{h.credibility.tier}</Pill>
                    </div>
                    {h.note && (
                      <p className="tiny muted" style={{ marginTop: 8, fontStyle: 'italic' }}>“{h.note}”</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Why this exists">
        <p className="muted" style={{ fontSize: 13.5 }}>
          Referral supply is finite, human, and currently invisible. A student cannot tell the difference between an
          engineer who would happily review three packets this month and one who has muted the channel for years — so
          they message both, and the second one’s experience is what sets the norm.
        </p>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 10 }}>
          Declaring capacity flips the flow from cold outreach to allocation. The employee spends one toggle and gets
          pre-vetted packets instead of templated DMs; the student spends their ask where it can actually be read.
        </p>
      </Card>
    </div>
  );
}
