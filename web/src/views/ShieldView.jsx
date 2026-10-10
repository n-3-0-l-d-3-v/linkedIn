import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Avatar, Card, Empty, Pill, Reason, Ring, riskTone, timeAgo } from '../components.jsx';

const STUDENT_ID = 'stu_neil';

export default function ShieldView() {
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reported, setReported] = useState({});
  const [bypassed, setBypassed] = useState({});

  const load = () =>
    api.shieldInbox(STUDENT_ID).then((list) => {
      setMessages(list);
      setSelected((cur) => list.find((m) => m.id === cur?.id) ?? list[0] ?? null);
    });

  useEffect(() => { load(); }, []);

  async function report(message) {
    await api.report({ messageId: message.id, reporterId: STUDENT_ID, reason: 'suspected_recruitment_fraud' });
    setReported((r) => ({ ...r, [message.id]: true }));
    await load();
  }

  function bypass(message) {
    api.interaction({ messageId: message.id, action: 'bypassed_warning' });
    setBypassed((b) => ({ ...b, [message.id]: true }));
  }

  return (
    <div className="stack">
      <div className="cols-wide">
        <Card title="Messages" subtitle="Every inbound message scored before you open it" pad={false}>
          <div className="scroll">
            {messages.map((m) => (
              <button key={m.id} className="item" aria-selected={m.id === selected?.id} onClick={() => setSelected(m)}>
                <Avatar name={m.sender.name} small scam={m.assessment.band === 'high'} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 5 }}>
                    <strong className="tiny" style={{ fontSize: 13 }}>{m.sender.name}</strong>
                    {m.sender.workplaceVerified && <span className="verified tiny">✓</span>}
                  </div>
                  <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.subject}
                  </div>
                  <div className="row-wrap" style={{ marginTop: 5 }}>
                    <Pill tone={riskTone(m.assessment.band)}>
                      {m.assessment.band === 'clear' ? 'Verified' : `Risk ${m.assessment.risk}`}
                    </Pill>
                    <span className="tiny dim">{timeAgo(m.receivedAt)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {selected ? (
          <MessageDetail
            message={selected}
            reported={!!reported[selected.id]}
            bypassed={!!bypassed[selected.id]}
            onReport={() => report(selected)}
            onBypass={() => bypass(selected)}
          />
        ) : (
          <Card><Empty>Select a message.</Empty></Card>
        )}
      </div>

      <LiveScorer />
    </div>
  );
}

function MessageDetail({ message, onReport, onBypass, reported, bypassed }) {
  const { assessment: a, sender } = message;
  const blocked = a.action.level === 'block_send' || a.action.level === 'interstitial';
  const hidden = blocked && !bypassed && !reported;

  return (
    <div className="stack">
      {a.band !== 'clear' ? (
        <Alert
          tone={a.band === 'high' ? 'red' : 'amber'}
          icon={a.band === 'high' ? '⚠' : '!'}
          title={a.verdict}
          actions={
            <>
              {!reported && (
                <button className="btn btn-danger btn-sm" onClick={onReport}>{a.action.primary}</button>
              )}
              {reported && <Pill tone="green">Reported — thank you</Pill>}
              {hidden && (
                <button className="btn btn-quiet btn-sm" onClick={onBypass}>{a.action.secondary}</button>
              )}
            </>
          }
        >
          {a.action.guidance}
        </Alert>
      ) : (
        <Alert tone="green" icon="✓" title={a.verdict}>
          {a.signals.hiringChannel.note}
        </Alert>
      )}

      <Card
        right={<Ring value={a.risk} size={58} tone={riskTone(a.band)} label="RISK" />}
        title={message.subject}
        subtitle={`${sender.name} · ${sender.title ?? ''}`}
      >
        <div className="row-wrap" style={{ marginBottom: 12 }}>
          {sender.identityVerified
            ? <Pill tone="green">Identity verified</Pill>
            : <Pill tone="red">No identity verification</Pill>}
          {sender.workplaceVerified
            ? <Pill tone="green">Workplace: {sender.verifiedCompany}</Pill>
            : <Pill tone="red">Workplace unverified</Pill>}
          {sender.claimedCompany && <Pill>Claims: {sender.claimedCompany}</Pill>}
          {sender.reportCount > 0 && <Pill tone="red">{sender.reportCount} reports</Pill>}
        </div>

        {hidden ? (
          <div style={{ padding: '28px 20px', textAlign: 'center', background: 'var(--line-soft)', borderRadius: 8 }}>
            <div style={{ fontSize: 26 }}>🛡</div>
            <p style={{ fontWeight: 600, marginTop: 8 }}>Message content hidden</p>
            <p className="tiny muted" style={{ marginTop: 4 }}>
              We have not blocked this outright — you stay in control. Read the analysis below first.
            </p>
          </div>
        ) : (
          <div className="msg-body">{message.body}</div>
        )}
      </Card>

      <Card title="Why this score" subtitle="Every signal that moved the number, with its evidence">
        {a.signals.content.length > 0 && (
          <>
            <div className="eyebrow" style={{ marginBottom: 7 }}>Message content</div>
            <div className="stack" style={{ gap: 10, marginBottom: 14 }}>
              {a.signals.content.map((s) => (
                <div key={s.id}>
                  <div className="row" style={{ gap: 7 }}>
                    <Pill tone={s.hard ? 'red' : 'amber'}>+{s.weight}</Pill>
                    <strong className="tiny">{s.label}</strong>
                    {s.hard && <Pill tone="red">hard rule</Pill>}
                  </div>
                  <p className="tiny muted" style={{ marginTop: 3 }}>{s.explain}</p>
                  <div style={{ marginTop: 4 }}><span className="excerpt">“{s.excerpt}”</span></div>
                </div>
              ))}
            </div>
          </>
        )}

        {a.signals.domains.length > 0 && (
          <>
            <div className="eyebrow" style={{ marginBottom: 7 }}>Domains referenced</div>
            <div className="stack" style={{ gap: 5, marginBottom: 14 }}>
              {a.signals.domains.map((d) => (
                <div key={d.domain} className="row" style={{ gap: 8 }}>
                  <Pill tone={d.verdict === 'official' ? 'green' : d.verdict === 'lookalike' ? 'red' : 'amber'}>
                    {d.verdict.replace(/_/g, ' ')}
                  </Pill>
                  <span className="mono">{d.domain}</span>
                  {d.note && <span className="tiny dim">— {d.note}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="eyebrow" style={{ marginBottom: 5 }}>Sender provenance</div>
        <div style={{ marginBottom: 14 }}>
          {a.signals.provenance.map((r, i) => <Reason key={i} kind={r.kind}>{r.text}</Reason>)}
          {a.signals.mismatch.map((r, i) => <Reason key={`m${i}`} kind={r.kind}>{r.text}</Reason>)}
        </div>

        <div className="eyebrow" style={{ marginBottom: 5 }}>Verified hiring channel</div>
        <Reason kind={a.signals.hiringChannel.valid ? 'good' : 'warn'}>
          {a.signals.hiringChannel.note}
        </Reason>

        <div className="divider" style={{ margin: '14px 0' }} />
        <div className="eyebrow" style={{ marginBottom: 6 }}>Risk contribution</div>
        <div className="row-wrap tiny mono">
          {Object.entries(a.breakdown).filter(([k]) => k !== 'raw').map(([k, v]) => (
            <Pill key={k} tone={v > 0 ? 'red' : v < 0 ? 'green' : ''}>
              {k}: {v > 0 ? '+' : ''}{v}
            </Pill>
          ))}
          <Pill tone="blue">raw {a.breakdown.raw} → squashed {a.risk}</Pill>
        </div>
      </Card>
    </div>
  );
}

const SAMPLE = `Dear Candidate, greetings of the day.

Congratulations! You have been selected for the post of Software Engineer Trainee at Northwind Systems without any interview.

To confirm your seat, please pay a refundable registration fee of Rs 2,500 via UPI within 24 hours. Limited slots.

Share your Aadhaar and PAN on WhatsApp +91 90XXXXXX21. Apply at n0rthwind-careers.com`;

/**
 * Live scorer. This is the single most convincing thing to hand someone in a
 * demo: let them paste a scam message they have actually received.
 */
function LiveScorer() {
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setResult(await api.assess({
        body: text,
        sender: {
          createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
          identityVerified: false, workplaceVerified: false,
          claimedCompany: 'Northwind Systems', connections: 22, reportCount: 0,
        },
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Score any message"
      subtitle="Paste a real recruiter message — yours or one a friend received — and watch the engine reason about it"
    >
      <div className="cols">
        <div>
          <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn" style={{ marginTop: 10 }} onClick={run} disabled={busy || !text.trim()}>
            {busy ? 'Scoring…' : 'Run Shield'}
          </button>
        </div>
        <div>
          {!result ? (
            <Empty>Results appear here.</Empty>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row">
                <Ring value={result.risk} size={64} tone={riskTone(result.band)} label="RISK" />
                <div style={{ minWidth: 0 }}>
                  <Pill tone={riskTone(result.band)}>{result.band}</Pill>
                  <p className="tiny muted" style={{ marginTop: 6 }}>{result.verdict}</p>
                </div>
              </div>
              {result.signals.content.map((s) => (
                <Reason key={s.id} kind={s.hard ? 'bad' : 'warn'}>
                  <strong>{s.label}</strong> <span className="excerpt">“{s.excerpt}”</span>
                </Reason>
              ))}
              {result.signals.domains.map((d) => (
                <Reason key={d.domain} kind={d.verdict === 'official' ? 'good' : 'bad'}>
                  <span className="mono">{d.domain}</span> — {d.note ?? d.verdict}
                </Reason>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
