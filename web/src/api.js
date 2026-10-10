const base = '/api';

async function call(path, options) {
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const payload = await res.json().catch(() => ({ ok: false, error: 'bad response' }));
  if (!payload.ok) throw new Error(payload.error ?? `request failed (${res.status})`);
  return payload.data;
}

export const api = {
  jobs: () => call('/jobs'),
  person: (id) => call(`/people/${id}`),
  referralPlan: (studentId, jobId) => call(`/referral-plan?studentId=${studentId}&jobId=${jobId}`),
  sendReferral: (body) => call('/referrals', { method: 'POST', body: JSON.stringify(body) }),
  referrerInbox: (employeeId) => call(`/referrals/inbox/${employeeId}`),
  decide: (id, body) => call(`/referrals/${id}/decision`, { method: 'POST', body: JSON.stringify(body) }),
  officeHours: () => call('/office-hours'),
  setOfficeHours: (id, body) => call(`/office-hours/${id}`, { method: 'POST', body: JSON.stringify(body) }),

  shieldInbox: (recipientId) => call(`/shield/inbox/${recipientId}`),
  assess: (body) => call('/shield/assess', { method: 'POST', body: JSON.stringify(body) }),
  report: (body) => call('/shield/report', { method: 'POST', body: JSON.stringify(body) }),
  interaction: (body) => call('/shield/interaction', { method: 'POST', body: JSON.stringify(body) }),
  patterns: () => call('/shield/patterns'),

  dashboard: (companyId) => call(`/dashboard/${companyId}`),
  reset: () => call('/admin/reset', { method: 'POST' }),
};
