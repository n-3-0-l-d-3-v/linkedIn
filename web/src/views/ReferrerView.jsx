import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Alert, Avatar, Card, Empty, Meter, Pill, Ring, Stat, Switch,
  credTone, fitTone, inr, timeAgo,
} from '../components.jsx';

const EMPLOYEES = [
  { id: 'emp_ananya', label: 'Ananya Rao — Staff Eng, Storage' },
  { id: 'emp_deepa', label: 'Deepa Krishnan — Engineer II, Storage' },
  { id: 'emp_leena', label: 'Leena Thomas — Research Eng, Kestrel' },
  { id: 'emp_rahul', label: 'Rahul Menon — Sales (poor track record)' },
];

export default function ReferrerView({ refreshKey }) {
  const [employeeId, setEmployeeId] = useState(EMPLOYEES[0].id);
  const [data, setData] = useState(null);
  const [note, setNote] = useState({});
  const [busy, setBusy] = useState(null);

  const load = () => api.referrerInbox(employeeId).then(setData);
  useEffect(() => { setData(null); load(); }, [employeeId, refreshKey]);

  async function decide(id, action) {
    setBusy(id);
    try {
      await api.decide(id, { action, note: note[id] ?? null });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleOfficeHours(open) {
    await api.setOfficeHours(employeeId, { open, note: data.employee.officeHoursNote });
    await load();
  }

  if (!data) return <Card><Empty>Loading…</Empty></Card>;

  const { employee, credibility, requests } = data;
  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');
  const slotsLeft = Math.max(0, (employee.monthlyReferralCapacity ?? 0) - (employee.referralsThisMonth ?? 0));

  return (
    <div className="cols">
      <div className="stack">
        <Card
          title={`${pending.length} packet${pending.length === 1 ? '' : 's'} waiting`}
          subtitle="Pre-vetted, scored, and ranked by fit — not a templated DM"
        >
          {pending.length === 0 ? (
            <Empty>Nothing waiting. Send a packet from the Student tab to see one arrive here.</Empty>
          ) : (
            <div className="stack">
              {pending.map((r) => (
                <PacketCard
                  key={r.id} request={r} busy={busy === r.id}
                  note={note[r.id] ?? ''} setNote={(v) => setNote((n) => ({ ...n, [r.id]: v }))}
                  onDecide={(action) => decide(r.id, action)}
                />
              ))}
            </div>
          )}
        </Card>

        {resolved.length > 0 && (
          <Card title="Resolved" pad={false}>
            {resolved.map((r) => (
              <div className="item" key={r.id} style={{ cursor: 'default' }}>
                <Avatar name={r.student?.name} small />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <strong className="tiny">{r.student?.name}</strong>
                    <span className="tiny dim">· {r.job?.title}</span>
                  </div>
                  {r.atsSubmission && (
                    <div className="tiny dim">
                      Submitted to {r.atsSubmission.provider} · {r.atsSubmission.visibility.replace(/_/g, ' ')}
                    </div>
                  )}
                </div>
                <Pill tone={r.status === 'referred' ? 'green' : r.status === 'declined' ? 'red' : 'amber'}>
                  {r.status.replace(/_/g, ' ')}
                </Pill>
              </div>
            ))}
          </Card>
        )}
      </div>

      <div className="stack">
        <Card title="Reviewer">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, font: 'inherit' }}
          >
            {EMPLOYEES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
          <p className="tiny dim" style={{ marginTop: 8 }}>
            Switch reviewers to see how the same system reads for someone with a strong track record versus someone
            who has been referring indiscriminately.
          </p>
        </Card>

        <Card
          title="Your referral track record"
          subtitle="Private. Only you see this number."
          right={<Ring value={credibility.score} size={54} tone={credTone(credibility.tier)} />}
        >
          <div className="row-wrap" style={{ marginBottom: 10 }}>
            <Pill tone={credTone(credibility.tier)}>{credibility.tier}</Pill>
            {credibility.spamReports > 0 && <Pill tone="red">{credibility.spamReports} spam reports</Pill>}
          </div>
          <p className="tiny muted">{credibility.privateSummary}</p>
          <div className="divider" style={{ margin: '12px 0' }} />
          <Meter label="Confidence in this score" value={credibility.confidence} tone="blue" />
          <p className="tiny dim" style={{ marginTop: 10 }}>
            Referring well raises how often good packets are routed to you. It is never shown publicly — a visible
            score would turn referring into a status game and push people to decline anyone risky.
          </p>
        </Card>

        <Card title="Referral office hours">
          <Switch on={employee.officeHoursOpen} onChange={toggleOfficeHours}>
            {employee.officeHoursOpen ? 'Open — you appear in student search' : 'Closed'}
          </Switch>
          {employee.officeHoursNote && (
            <p className="tiny muted" style={{ marginTop: 10, fontStyle: 'italic' }}>“{employee.officeHoursNote}”</p>
          )}
          <div className="grid-3" style={{ marginTop: 12 }}>
            <Stat num={slotsLeft} label="slots left this cycle" tone={slotsLeft === 0 ? 'red' : 'green'} />
            <Stat num={employee.monthlyReferralCapacity ?? 0} label="monthly capacity" />
          </div>
          <p className="tiny dim" style={{ marginTop: 10 }}>
            Capacity is what makes this survivable. Referral supply is finite and human; a system that does not ration
            it destroys the resource it runs on.
          </p>
        </Card>
      </div>
    </div>
  );
}

function PacketCard({ request, onDecide, busy, note, setNote }) {
  const [open, setOpen] = useState(true);
  const { student, job, fit, artifacts, bonus, warmPath } = request;

  return (
    <div className="artifact" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="row" style={{ padding: '13px 14px', alignItems: 'flex-start' }}>
        <Avatar name={student?.name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <strong style={{ fontSize: 14 }}>{student?.name}</strong>
            {student?.identityVerified && <span className="verified" title="Identity verified">✓</span>}
            <span className="tiny dim">· {timeAgo(request.createdAt)}</span>
          </div>
          <div className="tiny muted">{student?.headline}</div>
          <div className="tiny dim">
            {student?.school} · class of {student?.gradYear}
            {student?.educationVerified && ' · education verified'}
          </div>
          <div className="row-wrap" style={{ marginTop: 8 }}>
            <Pill tone="blue">{job?.title}</Pill>
            {bonus && <Pill tone="purple">Bonus {inr(bonus.amount)} · {bonus.note}</Pill>}
          </div>
        </div>
        {fit && <Ring value={fit.score} size={52} tone={fitTone(fit.band)} />}
      </div>

      <div style={{ padding: '0 14px 12px' }}>
        <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>“{request.pitch}”</p>

        {warmPath && (
          <div style={{ marginTop: 10 }}>
            <div className="eyebrow" style={{ marginBottom: 3 }}>How you are connected</div>
            {warmPath.steps.map((s, i) => (
              <div className="path-step" key={i}>
                <span className="path-node">{s.from}</span>
                <span className="path-arrow">→</span>
                <span className="path-node">{s.to}</span>
                <span className="dim">· {s.context ?? s.type}</span>
                {s.verified && <span className="verified">✓</span>}
              </div>
            ))}
          </div>
        )}

        <button className="btn btn-quiet btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'} evidence and score breakdown
        </button>

        {open && (
          <div style={{ marginTop: 10 }}>
            <div className="grid-2">
              <div className="stack" style={{ gap: 9 }}>
                <div className="eyebrow">Score breakdown</div>
                {fit?.components.map((c) => (
                  <Meter key={c.key} label={c.label} value={c.value} tone={fitTone(fit.band)} />
                ))}
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div className="eyebrow">Attached proof</div>
                {artifacts.map((a) => (
                  <div key={a.id} style={{ borderLeft: '3px solid var(--green)', paddingLeft: 9 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <strong className="tiny">{a.title}</strong>
                      {a.verified && <span className="verified">✓</span>}
                    </div>
                    <div className="tiny dim">{a.detail}</div>
                  </div>
                ))}
                {artifacts.length === 0 && <span className="tiny dim">No artifacts attached.</span>}
              </div>
            </div>

            {fit?.gaps.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Alert tone="amber" icon="·" title="Gaps you should know about before vouching">
                  <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                    {fit.gaps.map((g, i) => <li key={i}>{g.message}</li>)}
                  </ul>
                </Alert>
              </div>
            )}
          </div>
        )}

        <textarea
          rows={2}
          placeholder="Optional private note to the hiring team…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ marginTop: 12 }}
        />

        <div className="row-wrap" style={{ marginTop: 10 }}>
          <button className="btn" disabled={busy} onClick={() => onDecide('refer')}>Refer privately</button>
          <button className="btn btn-quiet" disabled={busy} onClick={() => onDecide('request_info')}>Ask for more</button>
          <button className="btn btn-quiet" disabled={busy} onClick={() => onDecide('decline')}>Decline</button>
          <span className="tiny dim">Declining returns your slot.</span>
        </div>
      </div>
    </div>
  );
}
