import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Empty, Pill, Ring, fitTone, timeAgo } from '../components.jsx';

const STUDENT_ID = 'stu_neil';

/**
 * What each status means to the person waiting on it. A raw status enum tells
 * a student nothing about what happens next, which is the whole reason cold
 * referral asks feel like shouting into a void.
 */
const STATUS = {
  pending: { tone: 'blue', label: 'Waiting for review', next: (r) => expiryLine(r) },
  referred: {
    tone: 'green',
    label: 'Referred',
    next: (r) =>
      r.submittedToAts
        ? `Submitted to ${r.submittedToAts.provider}. The hiring team takes it from here.`
        : 'Passed to the hiring team.',
  },
  info_requested: { tone: 'amber', label: 'More information requested', next: () => 'The reviewer wants to know more before deciding.' },
  declined: { tone: '', label: 'Not taken forward', next: () => 'The reviewer passed on this one. Their slot has been returned.' },
  expired: { tone: '', label: 'Expired', next: () => 'Nobody reviewed it in time. You can ask a different reviewer.' },
};

function expiryLine(r) {
  if (!r.expiresAt) return 'In the reviewer’s queue.';
  const days = Math.ceil((new Date(r.expiresAt) - Date.now()) / 86_400_000);
  return days > 0
    ? `In the reviewer’s queue. Expires in ${days} day${days === 1 ? '' : 's'} if not reviewed.`
    : 'Expires today if not reviewed.';
}

export default function TrackView({ refreshKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.sentReferrals(STUDENT_ID).then(setRows).catch((e) => setError(e.message));
  }, [refreshKey]);

  if (error) return <Card><Empty>{error}</Empty></Card>;
  if (!rows) return <Card><Empty>Loading…</Empty></Card>;

  return (
    <Card
      title="My referrals"
      subtitle="Every packet you have sent and where it stands"
      pad={false}
    >
      {rows.length === 0 ? (
        <Empty>You have not sent a referral packet yet. Start from the Student tab.</Empty>
      ) : (
        rows.map((r) => {
          const s = STATUS[r.status] ?? { tone: '', label: r.status, next: () => '' };
          return (
            <div className="item" key={r.id} style={{ cursor: 'default' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row-wrap">
                  <strong style={{ fontSize: 13.5 }}>{r.job?.title ?? 'Role no longer listed'}</strong>
                  <Pill tone={s.tone}>{s.label}</Pill>
                </div>
                <div className="tiny muted">
                  {r.job?.company} · sent to {r.referrer?.name ?? 'a reviewer'} · {timeAgo(r.createdAt)}
                </div>
                <div className="tiny dim" style={{ marginTop: 4 }}>{s.next(r)}</div>
              </div>
              {r.fitScore != null && (
                <Ring value={r.fitScore} size={44} tone={fitTone(r.fitScore >= 75 ? 'strong' : r.fitScore >= 55 ? 'viable' : 'stretch')} />
              )}
            </div>
          );
        })
      )}
    </Card>
  );
}
