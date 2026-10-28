// Automatic GPS activity tracking (migration 097). While a tech is clocked in,
// the phone is polled every 5 minutes and the position is turned into one of a
// few categories. Informational only: paid hours come from time_entries.

import { useEffect, useRef, useState } from 'react'
import * as db from './db'
import * as TC from './timeclock'

export const POLL_MS = 5 * 60 * 1000
export const MATCH_RADIUS_M = 200
export const TRANSIT_MPH = 10

// Hardcoded for now; move to settings if the list grows.
export const SUPPLY_HOUSES = [
  { name: 'Ferguson Honolulu',      lat: 21.3397, lng: -157.8698 },
  { name: 'Home Depot Pearl City',  lat: 21.3963, lng: -157.9683 },
  { name: 'Home Depot Kapolei',     lat: 21.3377, lng: -158.0786 },
]

export const CATEGORIES = {
  on_job:     { label: 'On Job',     color: '#16a085' },
  in_transit: { label: 'Driving',    color: '#2980b9' },
  parts_run:  { label: 'Parts Run',  color: '#d4a017' },
  shop:       { label: 'Shop',       color: '#8899bb' },
  stationary: { label: 'Stationary', color: '#8899bb' },
  off_clock:  { label: 'Off Clock',  color: '#b0b8c8' },
}

export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// pos: {lat,lng,at(ms)}; prev: same or null; jobs: [{id,lat,lng}]; homeBase: {lat,lng}|null
// Order is the spec's: job site, supply house, moving, home base, otherwise stationary.
export function categorize(pos, prev, { jobs = [], homeBase = null } = {}) {
  for (const j of jobs) {
    if (haversineM(pos.lat, pos.lng, j.lat, j.lng) <= MATCH_RADIUS_M) return { category: 'on_job', invoiceId: j.id }
  }
  for (const s of SUPPLY_HOUSES) {
    if (haversineM(pos.lat, pos.lng, s.lat, s.lng) <= MATCH_RADIUS_M) return { category: 'parts_run', invoiceId: null }
  }
  if (prev && pos.at > prev.at) {
    const mph = (haversineM(prev.lat, prev.lng, pos.lat, pos.lng) / ((pos.at - prev.at) / 1000)) * 2.23694
    if (mph > TRANSIT_MPH) return { category: 'in_transit', invoiceId: null }
  }
  if (homeBase && haversineM(pos.lat, pos.lng, homeBase.lat, homeBase.lng) <= MATCH_RADIUS_M) {
    return { category: 'shop', invoiceId: null }
  }
  return { category: 'stationary', invoiceId: null }
}

// Minutes per category from segments. An open segment counts to its last_seen_at.
export function breakdown(rows) {
  const out = {}
  for (const r of rows || []) {
    const end = r.endTime ? new Date(r.endTime) : new Date(r.lastSeenAt)
    const m = Math.max(0, (end - new Date(r.startTime)) / 60000)
    out[r.category] = (out[r.category] || 0) + m
  }
  return out
}

const hawaiiToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' })

// Jobs this tech could be standing at: today's visits on jobs he is assigned to
// (or earns commission on), plus the job his open shift is clocked to.
function candidateJobs(invoices, myId, shiftInvoiceId) {
  const today = hawaiiToday()
  return (invoices || []).filter(inv => {
    if (inv.deletedAt) return false
    if (inv.id === shiftInvoiceId) return true
    if (inv.assignedTechId !== myId && inv.commissionTechId !== myId) return false
    return (inv.visits || []).some(v => (v.start || '').slice(0, 10) === today)
  })
}

// Runs the 5-minute poll while `session` (a time_entries row) is open and
// returns the current segment ({category, invoiceId, lastSeenAt}) or null.
export function useActivityTracking({ session, myId, invoices }) {
  const [current, setCurrent] = useState(null)
  const ref = useRef({ prev: null, seg: null, coords: new Map(), home: undefined, invoices, session })
  ref.current.invoices = invoices
  ref.current.session = session
  const sessionId = session?.id || null

  useEffect(() => {
    if (!sessionId || !myId) return
    let cancelled = false
    const R = ref.current

    const poll = async () => {
      if (R.busy) return
      R.busy = true
      try {
        const fix = await TC.getPosition()
        if (!fix || cancelled) return
        const pos = { lat: fix.lat, lng: fix.lng, at: Date.now() }
        if (R.home === undefined) R.home = await db.loadHomeBase()
        const sess = R.session
        const jobs = []
        for (const inv of candidateJobs(R.invoices, myId, sess?.invoiceId)) {
          if (!R.coords.has(inv.id)) R.coords.set(inv.id, await TC.ensureJobCoords(inv).catch(() => null))
          const c = R.coords.get(inv.id)
          if (c) jobs.push({ id: inv.id, ...c })
        }
        const res = categorize(pos, R.prev, { jobs, homeBase: R.home })
        R.prev = pos
        if (cancelled) return
        R.seg = await db.recordActivity({ seg: R.seg, sessionId, ...res, lat: pos.lat, lng: pos.lng })
        setCurrent(R.seg)
      } catch (e) {
        console.warn('activity poll failed:', e)
      } finally { R.busy = false }
    }

    ;(async () => {
      // Pick up a segment left open by a reload; recordActivity closes it if
      // it belongs to another session.
      R.seg = await db.loadOpenActivity().catch(() => null)
      if (!cancelled) { setCurrent(R.seg); poll() }
    })()
    const iv = setInterval(poll, POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible' && (!R.seg || Date.now() - new Date(R.seg.lastSeenAt) > POLL_MS)) poll()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [sessionId, myId])

  // Clock-out: close whatever is open.
  useEffect(() => {
    const R = ref.current
    if (sessionId) { R.hadSession = true; return }
    // Only on the clocked-in -> clocked-out transition: at app start the shift
    // has not loaded yet and sessionId is briefly null.
    if (!R.hadSession) return
    R.hadSession = false
    R.prev = null
    db.closeOpenActivity().catch(() => {})
    R.seg = null
    setCurrent(null)
  }, [sessionId])

  return current
}
