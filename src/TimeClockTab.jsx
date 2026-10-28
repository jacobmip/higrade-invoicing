// The time clock: one card to start and stop a shift, and the week behind it.
//
// Built for a phone held in one hand at a front door. One primary button, a
// readable elapsed time, and a job picker that puts today's work at the top.
//
// The honesty model is worth knowing before changing anything here. Every
// number that decides pay — distance to the job, whether that is on site, how
// many minutes ran — is computed by a database trigger (migration 072). This
// file sends the raw GPS fix and nothing else. It also never blocks a clock
// event: no fix, a weak fix or a fix far from the job all still clock in, and
// the off-site case texts Jake from the database (migration 073). A man locked
// out of his own timesheet by a bad GPS reading is a worse outcome than an
// entry Jake has to look at.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as db from './db';
import * as TC from './timeclock';
import { ActivityBadge } from './ActivityBits.jsx';

const NAVY = '#0a1628';
const ORANGE = '#E8622A';
const GREEN = '#16a085';
const RED = '#c0392b';

const card = {
  background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
  boxShadow: '0 1px 3px rgba(10,22,40,0.06)',
};
const heading = {
  fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14,
  letterSpacing: 1, color: '#8899bb', textTransform: 'uppercase', marginBottom: 8,
};

function hhmm(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  const isToday = dt.toDateString() === today.toDateString();
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  if (isToday) return 'Today';
  if (dt.toDateString() === yest.toDateString()) return 'Yesterday';
  return dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function SiteChip({ onSite, meters }) {
  const st = TC.siteStatus(onSite, meters);
  const color = st.key === 'off' ? RED : st.key === 'on' ? GREEN : '#8899bb';
  const bg = st.key === 'off' ? '#fdecea' : st.key === 'on' ? '#eaf7ef' : '#f0f2f8';
  return (
    <span style={{
      background: bg, color, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5,
      padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase',
      fontFamily: "'Barlow Condensed', sans-serif", whiteSpace: 'nowrap',
    }}>{st.label}</span>
  );
}

export default function TimeClockTab({ invoices, isAdmin, myId, users, onOpenInvoice, onShiftChange, activitySeg }) {
  const [open, setOpen] = useState(null);         // my open shift
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(null);       // what we're waiting on
  const [err, setErr] = useState(null);
  const [kind, setKind] = useState('job');
  const [jobId, setJobId] = useState('');
  const [note, setNote] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());
  const [whoFilter, setWhoFilter] = useState('');
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  // Tick only while a shift is open, so a backgrounded phone is not re-rendering
  // every second for nothing.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const reload = async () => {
    const since = new Date(Date.now() - 28 * 86400000).toISOString();
    const [o, list] = await Promise.all([db.loadOpenTimeEntry(), db.loadTimeEntries({ from: since })]);
    if (!mounted.current) return;
    setOpen(o);
    setEntries(list);
    setLoading(false);
    // Keep the header banner honest the moment a shift starts or ends,
    // instead of waiting for its own poll.
    if (onShiftChange) onShiftChange(o);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  // Jobs worth offering: live documents, soonest-scheduled first, then by
  // date. RLS has already limited this to his own and his assigned work.
  const jobOptions = useMemo(() => {
    const live = (invoices || []).filter(i => !i.deletedAt);
    const score = (i) => {
      const v = (i.visits || [])[0];
      const when = v?.start || i.gcalDate || i.date || '';
      return when ? String(when) : '9999';
    };
    const todayStr = dayKey(new Date().toISOString());
    return live
      .map(i => ({
        id: i.id,
        label: `${i.id} · ${i.client || i.clientName || 'No name'}`,
        sub: TC.jobAddressLine(i) || '',
        isToday: String(score(i)).slice(0, 10) === todayStr,
        sort: score(i),
      }))
      .sort((a, b) => (a.isToday === b.isToday ? String(a.sort).localeCompare(String(b.sort)) : a.isToday ? -1 : 1))
      .slice(0, 60);
  }, [invoices]);

  const invById = useMemo(() => {
    const m = new Map();
    for (const i of (invoices || [])) m.set(i.id, i);
    return m;
  }, [invoices]);

  const needsJob = TC.KINDS.find(k => k.id === kind)?.needsJob;

  const doClockIn = async () => {
    setErr(null);
    if (needsJob && !jobId) { setErr('Pick the job first.'); return; }
    setBusy(true);
    try {
      const inv = jobId ? invById.get(jobId) : null;
      await TC.startShift({ invoice: inv, kind, note, onStage: setStage });
      setNote('');
      await reload();
    } catch (e) {
      if (e?.code === 'ALREADY_CLOCKED_IN') {
        setErr('You are already on the clock. Pull down to refresh.');
        await reload();
      } else {
        console.warn('clockIn failed:', e);
        setErr('Could not start the shift. Check your connection and try again.');
      }
    } finally {
      setBusy(false); setStage(null);
    }
  };

  const doClockOut = async () => {
    setErr(null);
    setBusy(true);
    try {
      await TC.endShift(open.id, { onStage: setStage });
      await reload();
    } catch (e) {
      console.warn('clockOut failed:', e);
      setErr('Could not close the shift. Check your connection and try again.');
    } finally {
      setBusy(false); setStage(null);
    }
  };

  const nameOf = (id) => {
    if (id === myId) return 'You';
    const u = (users || []).find(x => x.id === id);
    return u?.displayName || 'Unknown';
  };

  const visible = useMemo(
    () => (whoFilter ? entries.filter(e => e.techId === whoFilter) : entries),
    [entries, whoFilter]
  );

  const byDay = useMemo(() => {
    const groups = new Map();
    for (const e of visible) {
      const k = dayKey(e.clockInAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  const weekStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return d.getTime();
  }, []);
  const weekMine = visible.filter(e => e.techId === (whoFilter || myId) && new Date(e.clockInAt).getTime() >= weekStart);
  const weekTotals = { ...TC.totals(weekMine), minutes: TC.paidMinutes(weekMine.filter(e => e.clockOutAt)) };
  const flagged = entries.filter(e => (e.clockInOnSite === false || e.clockOutOnSite === false) && !e.reviewedAt);

  return (
    <div style={{ padding: 16, paddingBottom: 100 }}>
      {/* ── The clock itself ── */}
      <div style={{ ...card, background: open ? NAVY : '#fff' }}>
        {open ? (
          <>
            <div style={{ ...heading, color: '#8899bb', marginBottom: 4 }}>On the clock</div>
            {activitySeg && <div style={{ marginBottom: 6 }}><ActivityBadge seg={activitySeg} /></div>}
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 44, color: '#fff', lineHeight: 1 }}>
              {TC.fmtMinutes(TC.elapsedMinutes(open, nowMs))}
            </div>
            <div style={{ color: '#c3ccdd', fontSize: 12.5, margin: '6px 0 10px' }}>
              Started {hhmm(open.clockInAt)}
              {open.invoiceId ? ` · ${open.invoiceId}` : ''}
              {open.kind !== 'job' ? ` · ${TC.KINDS.find(k => k.id === open.kind)?.label || open.kind}` : ''}
            </div>
            <div style={{ marginBottom: 12 }}>
              <SiteChip onSite={open.clockInOnSite} meters={open.clockInM} />
            </div>
            <button
              onClick={doClockOut}
              disabled={busy}
              style={{
                width: '100%', padding: '15px 0', borderRadius: 10, border: 'none',
                background: busy ? '#8899bb' : ORANGE, color: '#fff', cursor: busy ? 'default' : 'pointer',
                fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 19,
                letterSpacing: 1, textTransform: 'uppercase',
              }}
            >{busy ? (stage || 'Working…') : 'Clock out'}</button>
          </>
        ) : (
          <>
            <div style={heading}>Clock in</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
              {TC.KINDS.filter(k => !k.hidden).map(k => {
                const on = kind === k.id;
                return (
                  <button
                    key={k.id}
                    onClick={() => { setKind(k.id); setErr(null); }}
                    style={{
                      padding: '7px 11px', borderRadius: 7, cursor: 'pointer',
                      border: on ? `1.5px solid ${ORANGE}` : '1px solid #e4e8f2',
                      background: on ? ORANGE : '#fff', color: on ? '#fff' : '#8899bb',
                      fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
                      fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase',
                    }}
                  >{k.label}</button>
                );
              })}
            </div>

            {needsJob && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6677aa', letterSpacing: 0.8, textTransform: 'uppercase' }}>Which job</label>
                <select
                  value={jobId}
                  onChange={e => { setJobId(e.target.value); setErr(null); }}
                  style={{ width: '100%', padding: '11px 10px', borderRadius: 8, border: '1px solid #dde2ee', fontSize: 15, marginTop: 4, background: '#fff', boxSizing: 'border-box' }}
                >
                  <option value="">Pick a job…</option>
                  {jobOptions.map(o => (
                    <option key={o.id} value={o.id}>{o.isToday ? '• ' : ''}{o.label}</option>
                  ))}
                </select>
                {jobId && (
                  <div style={{ fontSize: 11, color: '#99a3b8', marginTop: 5, lineHeight: 1.4 }}>
                    {TC.jobAddressLine(invById.get(jobId)) || 'No job address on this one — the on-site check will read as unknown.'}
                  </div>
                )}
              </div>
            )}

            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional)"
              style={{ width: '100%', padding: '11px 10px', borderRadius: 8, border: '1px solid #dde2ee', fontSize: 15, marginBottom: 10, boxSizing: 'border-box' }}
            />

            <button
              onClick={doClockIn}
              disabled={busy}
              style={{
                width: '100%', padding: '15px 0', borderRadius: 10, border: 'none',
                background: busy ? '#8899bb' : GREEN, color: '#fff', cursor: busy ? 'default' : 'pointer',
                fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 19,
                letterSpacing: 1, textTransform: 'uppercase',
              }}
            >{busy ? (stage || 'Working…') : 'Clock in'}</button>
            <div style={{ fontSize: 10.5, color: '#aab4c8', marginTop: 8, lineHeight: 1.45 }}>
              Your phone's location is recorded at both ends. If it can't get a
              fix you can still clock in — the entry just says the location is
              unknown.
            </div>
          </>
        )}
        {err && (
          <div style={{ marginTop: 10, fontSize: 12, color: open ? '#ffb4a2' : RED, lineHeight: 1.4 }}>{err}</div>
        )}
      </div>

      {/* ── This week ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <div style={heading}>This week</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: NAVY }}>
            {TC.fmtMinutes(weekTotals.minutes)}
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#99a3b8', lineHeight: 1.45 }}>
          Closed shifts since Monday
          {weekTotals.openCount ? ` · ${weekTotals.openCount} still open` : ''}
          {weekTotals.flaggedCount ? ` · ${weekTotals.flaggedCount} off site` : ''}
        </div>
      </div>

      {/* ── Admin: whose timesheet, and what needs a look ── */}
      {isAdmin && (
        <>
          {flagged.length > 0 && (
            <div style={{ ...card, border: `1px solid #f5c6bd` }}>
              <div style={{ ...heading, color: RED }}>Needs a look ({flagged.length})</div>
              {flagged.map(e => (
                <div key={e.id} style={{ borderTop: '1px solid #f4f6fa', padding: '9px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>
                      {nameOf(e.techId)} · {dayLabel(dayKey(e.clockInAt))} {hhmm(e.clockInAt)}
                    </div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                      <SiteChip onSite={e.clockInOnSite} meters={e.clockInM} />
                      {e.clockOutAt && <SiteChip onSite={e.clockOutOnSite} meters={e.clockOutM} />}
                    </div>
                    {e.invoiceId && (
                      <button
                        onClick={() => onOpenInvoice && onOpenInvoice(e.invoiceId)}
                        style={{ background: 'none', border: 'none', padding: '4px 0 0', color: ORANGE, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
                      >{e.invoiceId} →</button>
                    )}
                  </div>
                  <button
                    onClick={async () => { await db.reviewTimeEntry(e.id); reload(); }}
                    style={{ flexShrink: 0, padding: '7px 11px', borderRadius: 7, border: '1px solid #dde2ee', background: '#fff', color: '#8899bb', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', cursor: 'pointer' }}
                  >OK</button>
                </div>
              ))}
            </div>
          )}

          {(users || []).length > 1 && (
            <div style={card}>
              <div style={heading}>Whose hours</div>
              <select
                value={whoFilter}
                onChange={e => setWhoFilter(e.target.value)}
                style={{ width: '100%', padding: '11px 10px', borderRadius: 8, border: '1px solid #dde2ee', fontSize: 15, background: '#fff', boxSizing: 'border-box' }}
              >
                <option value="">Everyone</option>
                {(users || []).map(u => (
                  <option key={u.id} value={u.id}>{u.displayName || 'Unnamed'}{u.id === myId ? ' (me)' : ''}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {/* ── The log ── */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#99a3b8', fontSize: 13, padding: 20 }}>Loading…</div>
      ) : byDay.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: '#99a3b8', fontSize: 13, lineHeight: 1.5 }}>
          No shifts yet. Clock in when you get to the job.
        </div>
      ) : (
        byDay.map(([k, list]) => {
          const t = TC.totals(list);
          return (
            <div key={k} style={card}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
                <div style={heading}>{dayLabel(k)}</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: '#8899bb' }}>
                  {TC.fmtMinutes(t.minutes)}
                </div>
              </div>
              {list.map(e => (
                <div key={e.id} style={{ borderTop: '1px solid #f4f6fa', padding: '9px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: NAVY, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isAdmin && e.techId !== myId ? `${nameOf(e.techId)} · ` : ''}
                        {e.invoiceId || TC.KINDS.find(x => x.id === e.kind)?.label || e.kind}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#99a3b8', marginTop: 2 }}>
                        {hhmm(e.clockInAt)} – {e.clockOutAt ? hhmm(e.clockOutAt) : 'still open'}
                        {e.editedByAdmin ? ' · edited' : ''}
                      </div>
                    </div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: e.clockOutAt ? NAVY : ORANGE, flexShrink: 0 }}>
                      {e.clockOutAt ? TC.fmtMinutes(e.minutes) : 'open'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                    <SiteChip onSite={e.clockInOnSite} meters={e.clockInM} />
                    {e.clockOutAt && <SiteChip onSite={e.clockOutOnSite} meters={e.clockOutM} />}
                  </div>
                  {e.note && <div style={{ fontSize: 11.5, color: '#778', marginTop: 5, lineHeight: 1.4 }}>{e.note}</div>}
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
