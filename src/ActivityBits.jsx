// Display pieces for GPS activity tracking (migration 097): the tech's own
// badge and the admin's live board.

import { useEffect, useMemo, useState } from 'react'
import * as db from './db'
import { CATEGORIES, breakdown } from './activity'

const NAVY = '#0a1628'
const STALE_MS = 20 * 60 * 1000

const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`
}
const hrs = (mins) => `${(Math.round((mins || 0) / 6) / 10).toFixed(1)}h`

export function ActivityBadge({ seg, style }) {
  if (!seg) return null
  const c = CATEGORIES[seg.category] || CATEGORIES.stationary
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 12,
      background: c.color, color: '#fff', fontFamily: "'Barlow Condensed', sans-serif",
      fontWeight: 700, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', ...style,
    }}>
      {c.label}{seg.invoiceId ? ` · ${seg.invoiceId}` : ''}
    </span>
  )
}

const COLS = [['on_job', 'on job'], ['in_transit', 'driving'], ['parts_run', 'parts run'], ['shop', 'shop']]

export function ActivityBoard({ users }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let dead = false
    const load = async () => {
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
      const r = await db.loadActivitySince(midnight.toISOString())
      if (!dead) setRows(r)
    }
    load()
    const iv = setInterval(load, 60000)
    return () => { dead = true; clearInterval(iv) }
  }, [])

  const techs = useMemo(() => {
    const by = new Map()
    for (const r of rows || []) { if (!by.has(r.techId)) by.set(r.techId, []); by.get(r.techId).push(r) }
    const name = (id) => (users || []).find(u => u.id === id)?.displayName || 'Unnamed'
    return [...by.entries()].map(([id, list]) => {
      const open = list.find(r => !r.endTime)
      const live = open && Date.now() - new Date(open.lastSeenAt) < STALE_MS
      return { id, name: name(id), open: live ? open : null, last: open || list[list.length - 1], bd: breakdown(list) }
    }).sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || a.name.localeCompare(b.name))
  }, [rows, users])

  if (rows === null || !techs.length) return null
  return (
    <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 12, padding: '14px 14px 6px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: NAVY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
        Live Activity
      </div>
      {techs.map(t => (
        <div key={t.id} style={{ padding: '8px 0', borderTop: '1px solid #eef1f7' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 600, color: NAVY }}>{t.name}</span>
            {t.open
              ? <ActivityBadge seg={t.open} />
              : <span style={{ fontSize: 12, color: '#8899bb' }}>Not clocked in</span>}
          </div>
          <div style={{ fontSize: 12, color: '#8899bb', marginTop: 3 }}>
            Last seen {ago(t.last.lastSeenAt)}
          </div>
          <div style={{ fontSize: 13, color: NAVY, marginTop: 3 }}>
            Today: {COLS.map(([k, l]) => `${hrs(t.bd[k])} ${l}`).join(' · ')}
          </div>
        </div>
      ))}
    </div>
  )
}
