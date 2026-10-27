// Time clock helpers: the phone's position, the job's position, and the
// arithmetic the UI needs to describe a shift.
//
// Deliberately thin. Every number that decides anything — distance to the job,
// whether that is on site, how many minutes a shift ran — is computed by a
// database trigger (migration 072), because the phone sending it belongs to
// the person being measured. What lives here is only what the browser alone
// can do: ask the device where it is, and ask Google where an address is.

import * as db from './db'
import { api } from './apiBase'

export const KINDS = [
  { id: 'job',    label: 'On a job',   needsJob: true  },
  { id: 'drive',  label: 'Driving',    needsJob: false },
  { id: 'supply', label: 'Supply run', needsJob: false },
  { id: 'shop',   label: 'Shop / yard', needsJob: false },
  { id: 'other',  label: 'Other',      needsJob: false },
  // The day clock has its own button (More sheet); it is not a clock-in choice.
  { id: 'day',    label: 'Day clock',  needsJob: false, hidden: true },
]

// One GPS fix. Resolves with null rather than rejecting when the device will
// not give one: a man who cannot get a fix must still be able to clock in, and
// the entry simply records "position unknown" instead of a false position.
// A null fix leaves clock_in_on_site NULL in the database, which reads as
// unknown and is never reported as off-site.
export function getPosition({ timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return }
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    // Belt and braces: some Android browsers never fire either callback when
    // location services are off at the OS level.
    const timer = setTimeout(() => done(null), timeoutMs + 1500)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        done({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        })
      },
      () => { clearTimeout(timer); done(null) },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    )
  })
}

// The one-line address string to geocode for a job. Unit and building numbers
// are left off on purpose: they do not move the pin and an apartment number
// confuses the geocoder more often than it helps.
export function jobAddressLine(inv) {
  const a = inv?.jobAddress || null
  const ci = inv?.clientInfo || null
  const parts = []
  if (a) {
    if (a.line1) parts.push(a.line1)
    const tail = [a.city, a.state, a.zip].filter(Boolean).join(' ')
    if (tail) parts.push(tail)
    if (!parts.length && a.line3) parts.push(a.line3)
  }
  if (!parts.length && ci) {
    if (ci.address1) parts.push(ci.address1)
    const tail = [ci.city, ci.state, ci.zip].filter(Boolean).join(' ')
    if (tail) parts.push(tail)
  }
  return parts.join(', ').trim()
}

// Makes sure the job has a geofence centre, geocoding and caching it on first
// use. Returns { lat, lng } or null.
//
// `precision` is checked because Google answers an unrecognised address with
// the middle of a zip code, and a geofence around a zip code would call
// everywhere on site. A weak fix is rejected rather than stored, so the entry
// records an unknown distance instead of a meaningless one.
export async function ensureJobCoords(inv) {
  if (!inv) return null
  if (typeof inv.jobLat === 'number' && typeof inv.jobLng === 'number') {
    return { lat: inv.jobLat, lng: inv.jobLng }
  }
  const address = jobAddressLine(inv)
  if (!address) return null
  try {
    const res = await fetch(api(`/api/geocode?address=${encodeURIComponent(address)}`))
    if (!res.ok) return null
    const g = await res.json()
    if (typeof g.lat !== 'number' || typeof g.lng !== 'number') return null
    if (g.precision && g.precision !== 'ROOFTOP' && g.precision !== 'RANGE_INTERPOLATED') return null
    await db.setJobCoords(inv.id, g.lat, g.lng, 'geocode')
    return { lat: g.lat, lng: g.lng }
  } catch (e) {
    console.warn('ensureJobCoords failed:', e)
    return null
  }
}

// "3h 42m". Takes minutes.
export function fmtMinutes(mins) {
  if (mins === null || mins === undefined) return '—'
  const m = Math.max(0, Math.round(mins))
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}

// Elapsed minutes of an open shift, from its start to now.
export function elapsedMinutes(entry, nowMs = Date.now()) {
  if (!entry?.clockInAt) return 0
  return Math.max(0, (nowMs - new Date(entry.clockInAt).getTime()) / 60000)
}

export function fmtDistance(m) {
  if (m === null || m === undefined) return null
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`
}

// How a shift's location should be described. Three states, not two:
// unknown is its own answer and must never be shown as off-site.
export function siteStatus(onSite, meters) {
  if (onSite === null || onSite === undefined) return { key: 'unknown', label: 'No GPS fix' }
  if (onSite) return { key: 'on', label: `On site${meters != null ? ` · ${fmtDistance(meters)}` : ''}` }
  return { key: 'off', label: `Off site${meters != null ? ` · ${fmtDistance(meters)} away` : ''}` }
}

// Totals for a set of entries, in minutes, split the way payroll needs it.
export function totals(entries) {
  let open = 0, closed = 0, flagged = 0
  for (const e of entries || []) {
    if (e.kind === 'day') continue // paid hours are counted once, see dayBreakdown()
    if (e.clockOutAt) closed += e.minutes || 0
    else open += 1
    if (e.clockInOnSite === false || e.clockOutOnSite === false) flagged += 1
  }
  return { minutes: closed, openCount: open, flaggedCount: flagged }
}

// The whole clock-in sequence, shared by the Time Clock tab and the clock button
// on a job. The fence centre and the device fix run in parallel and neither is
// allowed to stop the clock. `onStage` reports what we are waiting on.
export async function startShift({ invoice = null, kind = 'job', note = '', onStage } = {}) {
  onStage?.('Finding the job and your location…')
  const [, coords] = await Promise.all([
    invoice ? ensureJobCoords(invoice).catch(() => null) : Promise.resolve(null),
    getPosition(),
  ])
  onStage?.('Starting your shift…')
  return db.clockIn({ invoiceId: invoice?.id || null, kind, coords, note })
}

export async function endShift(entryId, { onStage } = {}) {
  onStage?.('Getting your location…')
  const coords = await getPosition()
  onStage?.('Closing your shift…')
  return db.clockOut(entryId, { coords })
}

// Day clock (migration 092): start of workday to end of workday, no job. The
// day clock already includes the time spent on jobs, so paid hours must never
// be day + job. For one person on one local date: the day clock's minutes if
// he ran one, otherwise the sum of his job-type shifts.
export function entryMinutes(e, nowMs = Date.now()) {
  return e.clockOutAt ? (e.minutes || 0) : elapsedMinutes(e, nowMs)
}

export function dayBreakdown(entries, nowMs = Date.now()) {
  let day = 0, job = 0, hasDay = false
  for (const e of entries || []) {
    const m = entryMinutes(e, nowMs)
    if (e.kind === 'day') { day += m; hasDay = true } else job += m
  }
  return { day, job, hasDay, paid: hasDay ? day : job, other: hasDay ? Math.max(0, day - job) : 0 }
}

export async function startDay({ onStage } = {}) {
  onStage?.('Getting your location…')
  const coords = await getPosition()
  onStage?.('Starting your day…')
  return db.clockIn({ invoiceId: null, kind: 'day', coords })
}

export const endDay = (entryId, opts) => endShift(entryId, opts)

// Paid minutes across many days for one person: each local date counts once,
// as the day clock if he ran one, else his job-type shifts.
export function paidMinutes(entries, nowMs = Date.now()) {
  const byDay = new Map()
  for (const e of entries || []) {
    const d = new Date(e.clockInAt)
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(e)
  }
  let total = 0
  for (const list of byDay.values()) total += dayBreakdown(list, nowMs).paid
  return total
}
