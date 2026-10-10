import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Card, Empty, Meter, Pill, Ring, Stat, credTone, inr, livenessTone, riskTone } from '../components.jsx';

const COMPANIES = [
  { id: 'northwind', label: 'Northwind Systems' },
  { id: 'meridian', label: 'Meridian Analytics' },
  { id: 'kestrel', label: 'Kestrel Labs' },
  { id: 'zenithpay', label: 'Zenith Payments' },
];

/**
 * The employer-facing view. This is the part that turns the proposal from
 * "a safety feature users like" into "a thing Talent Solutions can sell",
 * which is the difference between a nice idea and a funded roadmap item.
 */
export default function EmployerView() {
  const [companyId, setCompanyId] = useState('northwind');
  const [data, setData] = useState(null);

  useEffect(() => { setData(null); api.dashboard(companyId).then(setData); }, [companyId]);

  if (!data) return <Card><Empty>Loading…</Empty></Card>;

  const { postings, brandProtection, referralFunnel, company } = data;

  return (
    <div className="stack">
      <Card>
        <div className="row-wrap">
          <div>
            <div className="eyebrow">Talent Solutions · Hiring Trust</div>
            <h1 style={{ marginTop: 2 }}>{company.name}</h1>
            <p className="tiny muted">ATS: {company.atsProvider} · Referral bonus {inr(company.referralBonus.amount)}</p>
          </div>
          <div className="spacer" />
          <select
            value={companyId} onChange={(e) => setCompanyId(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, font: 'inherit' }}
          >
            {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </Card>

      <div className="grid-3">
        <Stat num={postings.active} label="Postings actively hiring" tone="green" />
        <Stat num={postings.stale} label="Postings at ghost-job risk" tone={postings.stale ? 'red' : 'green'} />
        <Stat num={brandProtection.highRisk} label="High-risk impersonations of you" tone={brandProtection.highRisk ? 'red' : 'green'} />
        <Stat num={`${referralFunnel.utilisation}%`} label="Referral capacity used" tone="blue" />
      </div>

      {postings.atRisk.length > 0 && (
        <Card
          title="Postings at compliance risk"
          subtitle="Several jurisdictions now require postings to reflect genuine hiring intent"
        >
          <div className="stack">
            {postings.atRisk.map((p) => (
              <Alert key={p.id} tone="red" icon="⚠" title={`${p.title} — liveness ${p.score}/100`}>
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {p.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </Alert>
            ))}
          </div>
          <p className="tiny dim" style={{ marginTop: 12 }}>
            Surfaced to you before a candidate ever files a complaint. The remedy is a one-click close or refresh —
            we never delist your posting on your behalf.
          </p>
        </Card>
      )}

      <div className="cols">
        <Card title="Posting health" subtitle="Every open requisition, scored" pad={false}>
          {postings.detail.map((p) => (
            <div className="item" key={p.id} style={{ cursor: 'default', display: 'block' }}>
              <div className="row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong className="tiny" style={{ fontSize: 13 }}>{p.title}</strong>
                  <div className="tiny dim">{p.applicantCount} applicants</div>
                </div>
                <Pill tone={livenessTone(p.liveness.band)}>{p.liveness.label}</Pill>
                <Ring value={p.liveness.score} size={40} tone={livenessTone(p.liveness.band)} />
              </div>
              <div className="stack" style={{ gap: 6, marginTop: 9 }}>
                {p.liveness.components.map((c) => (
                  <Meter key={c.key} label={c.label} value={c.value} tone={livenessTone(p.liveness.band)} />
                ))}
              </div>
            </div>
          ))}
        </Card>

        <div className="stack">
          <Card title="Brand protection" subtitle="People impersonating you to candidates">
            {brandProtection.incidents.length === 0 ? (
              <Empty>No impersonation detected.</Empty>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {brandProtection.incidents.map((i) => (
                  <div key={i.messageId} className="artifact">
                    <div className="row" style={{ gap: 7 }}>
                      <Pill tone={riskTone(i.band)}>Risk {i.risk}</Pill>
                      <strong className="tiny">{i.senderName}</strong>
                    </div>
                    <ul className="tiny muted" style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                      {i.topSignals.map((s, n) => <li key={n}>{s}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            <p className="tiny dim" style={{ marginTop: 10 }}>
              Today an employer finds out they are being impersonated when a defrauded candidate emails them. This
              inverts that.
            </p>
          </Card>

          <Card title="Referral funnel">
            <div className="grid-3" style={{ marginBottom: 12 }}>
              <Stat num={referralFunnel.pending} label="awaiting review" />
              <Stat num={referralFunnel.referred} label="referred" tone="green" />
              <Stat num={referralFunnel.openOfficeHours} label="open office hours" tone="blue" />
            </div>
            <Meter
              label={`Capacity used (${referralFunnel.used} of ${referralFunnel.capacity})`}
              value={referralFunnel.capacity ? referralFunnel.used / referralFunnel.capacity : 0}
              tone="blue"
            />
            <div className="divider" style={{ margin: '14px 0' }} />
            <div className="eyebrow" style={{ marginBottom: 8 }}>Referrer track records</div>
            <div className="stack" style={{ gap: 7 }}>
              {referralFunnel.topReferrers.map((r) => (
                <div className="row" key={r.id}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong className="tiny">{r.name}</strong>
                    <div className="tiny dim">{r.team} · {r.credibility.privateSummary}</div>
                  </div>
                  <Pill tone={credTone(r.credibility.tier)}>{r.credibility.tier}</Pill>
                </div>
              ))}
            </div>
            <p className="tiny dim" style={{ marginTop: 10 }}>
              Aggregate only. Individual scores stay private to the employee.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
