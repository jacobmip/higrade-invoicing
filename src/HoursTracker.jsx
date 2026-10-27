// Admin hours tracker: every worker's time_entries for a week or a custom
// range, with a correction path. Reads and writes the same rows the clock does
// (migration 072); minutes and edited_by_admin are set by the database trigger,
// so after a save this shows the row the database sent back, not a local guess.
// Days are bucketed by the browser's local date, which is Hawaii for Jake.

import { useEffect, useMemo, useState } from 'react';
import * as db from './db';
import * as TC from './timeclock';
import { weekStartOf } from './commissionTiers.js';

const NAVY = '#0a1628';
const ORANGE = '#E8622A';
const GREEN = '#16a085';
const RED = '#c0392b';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n) => String(n).padStart(2, '0');
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return localKey(d); };
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const shortDate = (k) => parseKey(k).toLocaleDateString([], { month: 'short', day: 'numeric' });
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hoursText = (mins) => `${(Math.round((mins || 0) / 6) / 10).toFixed(1)}h`;
// <input type="datetime-local"> wants local wall-clock, no zone.
const toInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${localKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function Pencil() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8899bb" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Edited">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function EntryRow({ e, now, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [inV, setInV] = useState('');
  const [outV, setOutV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const active = !e.clockOutAt;
  const mins = active ? TC.elapsedMinutes(e, now) : e.minutes;

  const open = () => { setInV(toInput(e.clockInAt)); setOutV(toInput(e.clockOutAt)); setErr(''); setEditing(true); };
  const save = async () => {
    if (!inV) { setErr('Start time is required.'); return; }
    const a = new Date(inV), b = outV ? new Date(outV) : null;
    if (b && b < a) { setErr('End is before start.'); return; }
    setBusy(true); setErr('');
    try {
      const saved = await db.updateTimeEntryTimes(e.id, { clockInAt: a.toISOString(), clockOutAt: b ? b.toISOString() : null });
      onSaved(saved);
      setEditing(false);
    } catch (x) { setErr(x.message || 'Save failed.'); }
    setBusy(false);
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 8px', fontSize: 14, border: '1px solid #d6dcea', borderRadius: 6, background: '#fff' };
  return (
    <div style={{ background: active ? '#eaf7ef' : '#fff', border: `1px solid ${active ? '#bfe5cf' : '#eef1f7'}`, borderRadius: 8, padding: '8px 10px', marginTop: 6 }}>
      <div onClick={editing ? undefined : open} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: editing ? 'default' : 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: '#1a1a1a', fontWeight: 600 }}>
            {parseKey(localKey(new Date(e.clockInAt))).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
            {' · '}{hhmm(e.clockInAt)} – {active ? 'now' : hhmm(e.clockOutAt)}
          </div>
          <div style={{ fontSize: 10.5, color: '#8899bb', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.invoiceId ? e.invoiceId : (TC.KINDS.find(k => k.id === e.kind)?.label || e.kind)}
          </div>
        </div>
        {e.editedByAdmin && <Pencil />}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {active && <div style={{ fontSize: 9.5, fontWeight: 700, color: GREEN, letterSpacing: 0.6, fontFamily: "'Barlow Condensed', sans-serif" }}>ACTIVE</div>}
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: active ? GREEN : NAVY }}>{TC.fmtMinutes(mins)}</div>
        </div>
      </div>
      {editing && (
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 10.5, color: '#8899bb' }}>Start</label>
          <input type="datetime-local" value={inV} onChange={ev => setInV(ev.target.value)} style={inputStyle} />
          <label style={{ fontSize: 10.5, color: '#8899bb', display: 'block', marginTop: 6 }}>End (blank = still clocked in)</label>
          <input type="datetime-local" value={outV} onChange={ev => setOutV(ev.target.value)} style={inputStyle} />
          {err && <div style={{ color: RED, fontSize: 11.5, marginTop: 6 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={save} disabled={busy} style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: 6, background: ORANGE, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(false)} disabled={busy} style={{ flex: 1, padding: '8px 0', border: '1px solid #d6dcea', borderRadius: 6, background: '#fff', color: '#556', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HoursTracker({ users }) {
  const todayKey = localKey(new Date());
  const [start, setStart] = useState(weekStartOf(todayKey));
  const [end, setEnd] = useState(addDays(weekStartOf(todayKey), 6));
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    db.loadTimeEntries({
      from: parseKey(start).toISOString(),
      to: parseKey(addDays(end, 1)).toISOString(),
    }).then(ents => { if (!cancelled) { setEntries(ents.filter(e => e.clockInAt < parseKey(addDays(end, 1)).toISOString())); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [start, end]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const span = daysBetween(start, end) + 1;
  const dayKeys = useMemo(() => (span <= 7 ? Array.from({ length: span }, (_, i) => addDays(start, i)) : []), [start, span]);
  const isThisWeek = start === weekStartOf(todayKey) && span === 7;

  const shift = (dir) => { const n = Math.max(span, 1) * dir; setStart(addDays(start, n)); setEnd(addDays(end, n)); };
  const setRange = (s, e) => { if (s && e && s <= e) { setStart(s); setEnd(e); } };
  const onSaved = (saved) => setEntries(list => list.map(x => x.id === saved.id ? saved : x));

  const rows = useMemo(() => {
    const roster = (users || []).map(u => ({ id: u.id, name: u.displayName || 'Unnamed' }));
    const known = new Set(roster.map(r => r.id));
    for (const e of entries) if (!known.has(e.techId)) { known.add(e.techId); roster.push({ id: e.techId, name: 'Unknown user' }); }
    return roster.map(r => {
      const mine = entries.filter(e => e.techId === r.id).sort((a, b) => a.clockInAt.localeCompare(b.clockInAt));
      const perDay = {};
      let total = 0, active = 0;
      for (const e of mine) {
        const m = e.clockOutAt ? (e.minutes || 0) : TC.elapsedMinutes(e, now);
        if (!e.clockOutAt) active += 1;
        total += m;
        const k = localKey(new Date(e.clockInAt));
        perDay[k] = (perDay[k] || 0) + m;
      }
      return { ...r, mine, perDay, total, active };
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [users, entries, now]);

  const grand = rows.reduce((s, r) => s + r.total, 0);
  const arrow = { width: 34, height: 34, border: '1px solid #e4e8f2', borderRadius: 8, background: '#fff', color: NAVY, fontSize: 18, cursor: 'pointer', flexShrink: 0 };
  const dateIn = { flex: 1, minWidth: 0, padding: '6px 6px', fontSize: 13, border: '1px solid #e4e8f2', borderRadius: 6, background: '#fff' };

  return (
    <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 12, padding: '16px 14px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: NAVY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Hours</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={arrow} onClick={() => shift(-1)} aria-label="Previous">‹</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: NAVY }}>{shortDate(start)} – {shortDate(end)}</div>
          <div style={{ fontSize: 10.5, color: '#8899bb' }}>{isThisWeek ? 'This week' : `${span} day${span === 1 ? '' : 's'}`} · {hoursText(grand)} total</div>
        </div>
        <button style={arrow} onClick={() => shift(1)} aria-label="Next">›</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <input type="date" value={start} onChange={ev => setRange(ev.target.value, end >= ev.target.value ? end : ev.target.value)} style={dateIn} />
        <span style={{ color: '#8899bb', fontSize: 12 }}>to</span>
        <input type="date" value={end} onChange={ev => setRange(start <= ev.target.value ? start : ev.target.value, ev.target.value)} style={dateIn} />
        {!isThisWeek && <button onClick={() => { const s = weekStartOf(todayKey); setStart(s); setEnd(addDays(s, 6)); }} style={{ padding: '6px 8px', border: `1px solid ${ORANGE}`, borderRadius: 6, background: '#fff', color: ORANGE, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Today</button>}
      </div>

      {!loaded && <div style={{ fontSize: 12, color: '#aaa', padding: '14px 0' }}>Loading…</div>}
      {loaded && rows.map((r, i) => {
        const isOpen = !!open[r.id];
        const live = r.active > 0;
        return (
          <div key={r.id} style={{ borderTop: i === 0 ? '1px solid #f4f6fa' : '1px solid #f4f6fa', marginTop: i === 0 ? 12 : 0, padding: '10px 0' }}>
            <div onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#8899bb', width: 10 }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                {live && <span style={{ fontSize: 9.5, fontWeight: 700, color: GREEN, background: '#eaf7ef', padding: '2px 6px', borderRadius: 4, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 0.5 }}>ACTIVE</span>}
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: live ? GREEN : ORANGE, flexShrink: 0 }}>{hoursText(r.total)}</span>
              </div>
              {dayKeys.length > 0 && (
                <div style={{ display: 'flex', marginTop: 6, paddingLeft: 18 }}>
                  {dayKeys.map(k => (
                    <div key={k} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 9.5, color: '#8899bb' }}>{DOW[(parseKey(k).getDay() + 6) % 7]}</div>
                      <div style={{ fontSize: 11.5, color: r.perDay[k] ? NAVY : '#ccd2e0', fontWeight: r.perDay[k] ? 600 : 400 }}>{r.perDay[k] ? hoursText(r.perDay[k]) : '–'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {isOpen && (r.mine.length
              ? r.mine.map(e => <EntryRow key={e.id} e={e} now={now} onSaved={onSaved} />)
              : <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 8, paddingLeft: 18 }}>No entries in this range.</div>)}
          </div>
        );
      })}
      {loaded && !rows.length && <div style={{ fontSize: 12, color: '#aaa', padding: '14px 0' }}>No workers found.</div>}
    </div>
  );
}
