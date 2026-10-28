// Admin-only live map of clocked-in techs (Reports). Leaflet comes from a CDN,
// loaded the first time the card is opened. Positions: db.loadTeamPositions().

import { useEffect, useRef, useState } from 'react'
import * as db from './db'
import { CATEGORIES } from './activity'

const NAVY = '#0a1628'
const HONOLULU = [21.3069, -157.8583]
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const MARKER_COLORS = { on_job: '#27ae60', in_transit: '#2980b9', parts_run: '#f1c40f', shop: '#8e99a8', stationary: '#8e99a8' }

let leafletPromise = null
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link')
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS
      document.head.appendChild(css)
      const s = document.createElement('script')
      s.src = LEAFLET_JS
      s.onload = () => resolve(window.L)
      s.onerror = () => { leafletPromise = null; reject(new Error('Could not load the map library.')) }
      document.head.appendChild(s)
    })
  }
  return leafletPromise
}

const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`
}

function popupNode(t) {
  const box = document.createElement('div')
  const line = (text, bold) => {
    const d = document.createElement('div')
    d.textContent = text
    if (bold) d.style.fontWeight = '700'
    box.appendChild(d)
  }
  line(t.name, true)
  line((CATEGORIES[t.category] || CATEGORIES.stationary).label)
  if (t.category === 'on_job' && t.invoiceId) line(t.clientName ? `${t.invoiceId} · ${t.clientName}` : t.invoiceId)
  line(`Updated ${ago(t.updatedAt)}`)
  return box
}

export default function TeamMap({ users, invoices }) {
  const [open, setOpen] = useState(false)
  const [techs, setTechs] = useState(null)
  const [err, setErr] = useState('')
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)

  // Positions, refreshed every 60 seconds while the card is open.
  useEffect(() => {
    if (!open) return
    let dead = false
    const load = async () => {
      try { const r = await db.loadTeamPositions(); if (!dead) setTechs(r) } catch (e) { if (!dead) setErr(e.message) }
    }
    load()
    const iv = setInterval(load, 60000)
    return () => { dead = true; clearInterval(iv) }
  }, [open])

  // Build the map once the container exists; tear it down on close.
  useEffect(() => {
    if (!open) return
    let dead = false
    loadLeaflet().then(L => {
      if (dead || !mapEl.current) return
      const map = L.map(mapEl.current).setView(HONOLULU, 11)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      setTechs(t => (t ? [...t] : t)) // draw markers loaded before the map was ready
    }).catch(e => setErr(e.message))
    return () => {
      dead = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null }
    }
  }, [open])

  // Markers.
  useEffect(() => {
    const L = window.L
    if (!open || !L || !mapRef.current || !layerRef.current || !techs) return
    layerRef.current.clearLayers()
    for (const p of techs) {
      const t = {
        ...p,
        name: (users || []).find(u => u.id === p.techId)?.displayName || 'Unnamed',
        clientName: (invoices || []).find(i => i.id === p.invoiceId)?.client || '',
      }
      L.circleMarker([p.lat, p.lng], {
        radius: 11, weight: 2, color: '#fff', fillOpacity: 0.95,
        fillColor: MARKER_COLORS[p.category] || MARKER_COLORS.stationary,
      }).bindPopup(popupNode(t)).addTo(layerRef.current)
    }
  }, [techs, open, users, invoices])

  return (
    <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 12, padding: '14px 14px 14px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: NAVY,
        letterSpacing: 1, textTransform: 'uppercase',
      }}>
        <span>Team Map</span>
        <span style={{ color: '#8899bb' }}>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {err && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 6 }}>{err}</div>}
          <div ref={mapEl} style={{ height: 340, borderRadius: 8, overflow: 'hidden', background: '#e8ecf4' }} />
          <div style={{ fontSize: 12, color: '#8899bb', marginTop: 6 }}>
            {techs === null ? 'Loading...' : techs.length ? `${techs.length} clocked in. Updates every minute.` : 'No one is clocked in right now.'}
          </div>
        </div>
      )}
    </div>
  )
}
