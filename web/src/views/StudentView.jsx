import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Alert, Avatar, Card, Empty, Meter, Pill, Reason, Ring,
  fitTone, livenessTone, credTone, inr,
} from '../components.jsx';

const STUDENT_ID = 'stu_neil';

export default function StudentView({ onSent }) {
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState(null);
  const [plan, setPlan] = useState(null);
  const [picked, setPicked] = useState(null);
  const [pitch, setPitch] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.jobs().then((list) => {
      setJobs(list);
      setJobId((cur) => cur ?? list[0]?.id);
    });
  }, []);

  useEffect(() => {
    if (!jobId) return;
    setPlan(null); setPicked(null); setError(null); setSent(null); setPitch('');
    api.referralPlan(STUDENT_ID, jobId).then(setPlan).catch((e) => setError(e.message));
  }, [jobId]);

  async function send() {
    setBusy(true); setError(null);
    try {
      const record = await api.sendReferral({
        studentId: STUDENT_ID,
        jobId,
        referrerId: picked.employeeId,
        pitch,
        artifactIds: plan.passport.map((a) => a.id),
      });
      setSent(record);
      onSent?.();
      const fresh = await api.referralPlan(STUDENT_ID, jobId);
      setPlan(fresh);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cols-wide">
      <div className="stack">
        <Card title="Open roles" subtitle="Ranked with posting liveness applied" pad={false}>
          <div className="scroll">
            {jobs.map((j) => (
              <button key={j.id} className="item" aria-selected={j.id === jobId} onClick={() => setJobId(j.id)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{j.title}</div>
                  <div className="tiny muted">{j.company?.name} · {j.location}</div>
                  <div className="row-wrap" style={{ marginTop: 6 }}>
                    <Pill tone={livenessTone(j.liveness.band)}>{j.liveness.label}</Pill>
                    <span className="tiny dim">{j.applicantCount} applicants</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
        <p className="tiny dim" style={{ padding: '0 4px' }}>
          Low-liveness postings are labelled and demoted, never hidden. A slow employer is not a fraudulent one, and
          silently deleting a real req would be the worse error.
        </p>
      </div>

      {!plan ? (
        <Card><Empty>{error ?? 'Loading…'}</Empty></Card>
      ) : (
        <div className="stack">
          <JobHeader plan={plan} />
          <BeforeAfter plan={plan} />
          <FitPanel fit={plan.fit} />
          <PassportPanel passport={plan.passport} />
          <ReferrerPanel
            plan={plan} picked={picked} setPicked={setPicked}
            pitch={pitch} setPitch={setPitch} onSend={send} busy={busy} error={error} sent={sent}
          />
        </div>
      )}
    </div>
  );
}

function JobHeader({ plan }) {
  const { job } = plan;
  return (
    <Card>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>{job.title}</h2>
          <p className="muted" style={{ marginTop: 3 }}>
            {job.company?.name} · {job.team} · {job.location}
          </p>
          <div className="row-wrap" style={{ marginTop: 10 }}>
            <Pill tone={livenessTone(job.liveness.band)}>{job.liveness.label} · {job.liveness.score}</Pill>
            {job.atsSynced && job.atsReqOpen && <Pill tone="blue">Req open in {job.company?.atsProvider}</Pill>}
            {plan.referralBonus && (
              <Pill tone="purple">Referral bonus {inr(plan.referralBonus.amount)}</Pill>
            )}
          </div>
          {job.liveness.notes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Alert tone="amber" icon="◷" title="Why this posting is flagged">
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {job.liveness.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </Alert>
            </div>
          )}
        </div>
        <Ring value={job.liveness.score} tone={livenessTone(job.liveness.band)} label="LIVE" />
      </div>
    </Card>
  );
}

/**
 * The single most persuasive panel in the demo: what today's product does with
 * this exact student and this exact req, beside what Vouch does.
 */
function BeforeAfter({ plan }) {
  const { baseline, referrers } = plan;
  return (
    <Card title="What changes" subtitle="Same student, same requisition">
      <div className="compare">
        <div>
          <div className="compare-head" style={{ color: 'var(--ink-3)' }}>LinkedIn today</div>
          {baseline.buttonAvailable ? (
            <>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{baseline.reachableToday.length}</div>
              <p className="tiny muted">1st-degree contacts surfaced, unranked by requisition</p>
            </>
          ) : (
            <>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink-3)' }}>0</div>
              <p className="tiny muted">The “Ask for a referral” button does not appear</p>
            </>
          )}
          <p className="tiny dim" style={{ marginTop: 8 }}>{baseline.note}</p>
        </div>
        <div>
          <div className="compare-head" style={{ color: 'var(--blue)' }}>With Vouch</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--blue)' }}>{baseline.reachableWithVouch}</div>
          <p className="tiny muted">verified warm paths found, ranked by closeness to this req</p>
          <p className="tiny dim" style={{ marginTop: 8 }}>
            Paths run through shared labs, cohorts, contest teams and repositories — affiliations the platform can
            already verify but cannot currently traverse.
          </p>
        </div>
      </div>
    </Card>
  );
}

function FitPanel({ fit }) {
  return (
    <Card
      title="Pre-send fit"
      subtitle="Shown to you before the ask, and to the referrer with it"
      right={<Ring value={fit.score} tone={fitTone(fit.band)} size={58} />}
    >
      <div className="grid-2">
        <div className="stack" style={{ gap: 10 }}>
          {fit.components.map((c) => (
            <Meter key={c.key} label={c.label} value={c.value} weight={c.weight} tone={fitTone(fit.band)} />
          ))}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {fit.gaps.length === 0 ? (
            <Alert tone="green" icon="✓" title="No gaps found">
              Every required skill is claimed and backed by an artifact.
            </Alert>
          ) : (
            fit.gaps.map((g, i) => (
              <Alert key={i} tone={g.severity === 'high' ? 'red' : 'amber'} icon={g.severity === 'high' ? '!' : '·'} title={g.message}>
                {g.fix}
              </Alert>
            ))
          )}
        </div>
      </div>

      <div className="divider" style={{ margin: '14px 0' }} />
      <div className="row-wrap">
        {fit.evidence.map((e) => (
          <Pill key={e.skill} tone={e.strength >= 0.6 ? 'green' : e.strength > 0 ? 'amber' : 'red'}>
            {e.skill}
            {e.proof ? ` · proven` : e.claimed ? ' · claimed only' : ' · missing'}
          </Pill>
        ))}
      </div>
    </Card>
  );
}

function PassportPanel({ passport }) {
  return (
    <Card
      title="Skills Passport"
      subtitle="Auto-selected proof for THIS requisition — not a static badge shelf"
    >
      {passport.length === 0 ? (
        <Empty>No artifacts match this role’s requirements.</Empty>
      ) : (
        <div className="grid-2">
          {passport.map((a) => (
            <div className="artifact" key={a.id}>
              <div className="row" style={{ gap: 7 }}>
                <strong style={{ fontSize: 13 }}>{a.title}</strong>
                {a.verified && <span className="verified" title="Verified">✓</span>}
              </div>
              <p className="tiny muted" style={{ marginTop: 4 }}>{a.detail}</p>
              <div className="artifact-why">{a.whyAttached}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ReferrerPanel({ plan, picked, setPicked, pitch, setPitch, onSend, busy, error, sent }) {
  const canSend = picked && picked.available && pitch.trim().length >= 40 && plan.fit.sendRecommended;

  return (
    <Card
      title="Who to ask"
      subtitle="Routed by closeness to the requisition, not by who happens to work here"
    >
      <div className="stack" style={{ gap: 10 }}>
        {plan.referrers.map((r) => (
          <div
            key={r.employeeId}
            className="artifact"
            style={{
              cursor: r.available ? 'pointer' : 'not-allowed',
              opacity: r.available ? 1 : 0.62,
              borderColor: picked?.employeeId === r.employeeId ? 'var(--blue)' : undefined,
              background: picked?.employeeId === r.employeeId ? 'var(--blue-wash)' : undefined,
            }}
            onClick={() => r.available && setPicked(r)}
          >
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Avatar name={r.name} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 6 }}>
                  <strong style={{ fontSize: 13.5 }}>{r.name}</strong>
                  {r.verified && <span className="verified" title="Workplace verified">✓</span>}
                  {r.onHiringTeam && <Pill tone="blue">On this req</Pill>}
                  {r.officeHoursOpen && <Pill tone="green">Office hours open</Pill>}
                  {!r.available && <Pill tone="red">No slots left</Pill>}
                </div>
                <div className="tiny muted">{r.title} · {r.team}</div>
                <div style={{ marginTop: 7 }}>
                  {r.reasons.map((reason, i) => (
                    <Reason key={i} kind={reason.kind}>{reason.text}</Reason>
                  ))}
                </div>
                {r.warmPath && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
                    <div className="eyebrow" style={{ marginBottom: 4 }}>Warm path · {r.warmPath.hops} hop{r.warmPath.hops > 1 ? 's' : ''}</div>
                    {r.warmPath.steps.map((s, i) => (
                      <div className="path-step" key={i}>
                        <span className="path-node">{s.from}</span>
                        <span className="path-arrow">→</span>
                        <span className="path-node">{s.to}</span>
                        <span className="dim">· {s.context ?? s.type}</span>
                        {s.verified && <span className="verified" title="Verified affiliation">✓</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="row-wrap tiny dim" style={{ marginTop: 8 }}>
                  <span>{r.capacityRemaining} referral slot{r.capacityRemaining === 1 ? '' : 's'} left</span>
                  {r.credibility && (
                    <Pill tone={credTone(r.credibility.tier)}>
                      Track record: {r.credibility.tier}
                    </Pill>
                  )}
                </div>
              </div>
              <Ring value={r.score} size={48} tone={r.score >= 65 ? 'green' : r.score >= 45 ? 'blue' : 'grey'} />
            </div>
          </div>
        ))}
      </div>

      <div className="divider" style={{ margin: '16px 0' }} />

      {sent ? (
        <Alert tone="green" icon="✓" title="Referral packet sent — privately">
          It lands in {picked?.name}’s review queue with your fit score, the three artifacts above, and your pitch.
          Nothing about this appears on anyone’s feed. If they refer you, it goes straight into{' '}
          {plan.job.company?.atsProvider} against requisition {plan.job.id}.
        </Alert>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <h4>Your pitch{picked ? ` to ${picked.name}` : ''}</h4>
            <div className="spacer" />
            <span className={`tiny ${pitch.trim().length >= 40 ? 'dim' : 'muted'}`}>
              {pitch.trim().length}/40 minimum
            </span>
          </div>
          <textarea
            rows={4}
            placeholder={
              picked
                ? `Why this role, and why ${picked.name} specifically. Two or three lines. The artifacts are attached automatically — use this space for the part a document cannot say.`
                : 'Select a reviewer above first.'
            }
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            disabled={!picked}
          />
          {!plan.fit.sendRecommended && (
            <div style={{ marginTop: 10 }}>
              <Alert tone="red" icon="!" title="Sending is blocked for this pairing">
                {plan.fit.blockers[0]?.message} {plan.fit.blockers[0]?.fix}
              </Alert>
            </div>
          )}
          {error && (
            <div style={{ marginTop: 10 }}>
              <Alert tone="red" icon="!" title="Rejected by the server">{error}</Alert>
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={!canSend || busy} onClick={onSend}>
              {busy ? 'Sending…' : 'Send referral packet'}
            </button>
            <span className="tiny dim">
              Private to the reviewer. Never posted publicly.
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
