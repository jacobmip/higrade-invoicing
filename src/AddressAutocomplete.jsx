import { useState, useRef, useEffect } from 'react'
import { api } from './apiBase.js'

// Street-address input with Google Places suggestions, proxied through
// /api/geocode (mode=autocomplete). Picking a suggestion fills the input with
// the street line and calls onSelect({ line1, city, state, zip, lat, lng }),
// the structured parts coming from a second /api/geocode call.
//
// Props: value, onChange(string), onSelect(parts), onBlur, style, placeholder.
// The caller keeps its own onChange/onBlur wiring; this only adds the list.

function newToken() {
  try { return crypto.randomUUID() } catch { return String(Date.now()) + Math.random() }
}

export default function AddressAutocomplete({ value, onChange, onSelect, onBlur, style, placeholder, ...rest }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // Set when Google refuses the lookup (bad key, billing, API switched off).
  // Shown under the input so a dead dropdown is never silent again.
  const [failure, setFailure] = useState(null)
  const wrapRef = useRef(null)
  const tokenRef = useRef(newToken())
  const seqRef = useRef(0)
  const timerRef = useRef(null)
  const typedRef = useRef(false) // suggestions only follow the user's own typing
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect // pick() awaits a fetch; call the latest handler, not the one from click time

  useEffect(() => {
    if (!typedRef.current) return
    clearTimeout(timerRef.current)
    const q = (value || '').trim()
    if (q.length < 3) { setItems([]); setOpen(false); return }
    const seq = ++seqRef.current
    timerRef.current = setTimeout(async () => {
      try {
        const r = await fetch(api('/api/geocode') + '?mode=autocomplete&input=' + encodeURIComponent(q) + '&sessiontoken=' + tokenRef.current)
        const data = await r.json()
        if (seq !== seqRef.current) return // a newer keystroke superseded this
        if (data && !Array.isArray(data) && data.error) {
          console.warn('[address] suggestions unavailable:', data.error, data.message || '')
          setFailure(data.error)
        } else {
          setFailure(null)
        }
        const list = Array.isArray(data) ? data.slice(0, 5) : []
        setItems(list)
        setActive(-1)
        setOpen(list.length > 0)
      } catch {
        if (seq === seqRef.current) { setItems([]); setOpen(false); setFailure('NETWORK') }
      }
    }, 300)
    return () => clearTimeout(timerRef.current)
  }, [value])

  useEffect(() => {
    const away = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('touchstart', away)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('touchstart', away)
    }
  }, [])

  const pick = async (p) => {
    typedRef.current = false
    seqRef.current++
    setOpen(false)
    setItems([])
    const street = p.structured_formatting?.main_text || p.description
    onChange(street)
    tokenRef.current = newToken() // a session ends with the selection
    try {
      const r = await fetch(api('/api/geocode') + '?address=' + encodeURIComponent(p.description))
      const g = await r.json()
      if (g && !g.error && onSelectRef.current) {
        onSelectRef.current({ line1: street, city: g.city || '', state: g.state || '', zip: g.zip || '', lat: g.lat ?? null, lng: g.lng ?? null })
      }
    } catch { /* the street line is already filled; the blur geocode may still fill the rest */ }
  }

  const onKeyDown = (e) => {
    if (!open || items.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % items.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a <= 0 ? items.length - 1 : a - 1)) }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', marginBottom: style?.marginBottom }}>
      <input
        {...rest}
        style={{ ...style, marginBottom: 0 }}
        value={value || ''}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={e => { typedRef.current = true; onChange(e.target.value) }}
        onKeyDown={onKeyDown}
        onFocus={() => { if (items.length > 0) setOpen(true) }}
        onBlur={onBlur}
      />
      {failure && typedRef.current && (
        <div style={{ fontSize: 11, color: '#8894a8', marginTop: 3 }}>
          Address suggestions unavailable ({failure}). Type the address in full.
        </div>
      )}
      {open && items.length > 0 && (
        <div role="listbox" style={{
          position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 2, zIndex: 50,
          background: '#fff', border: '1.5px solid #dde2ee', borderRadius: 8,
          boxShadow: '0 4px 14px rgba(0,0,0,0.12)', overflow: 'hidden',
        }}>
          {items.map((p, i) => (
            <div
              key={p.place_id || i}
              role="option"
              aria-selected={i === active}
              // mousedown (not click) with preventDefault keeps the input from
              // blurring first, which would fire the caller's blur geocode.
              onMouseDown={e => { e.preventDefault(); pick(p) }}
              onTouchEnd={e => { e.preventDefault(); pick(p) }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '9px 12px', fontSize: 14, fontFamily: "'Barlow', sans-serif", color: '#222',
                cursor: 'pointer', background: i === active ? '#f4f6fa' : '#fff',
                borderTop: i === 0 ? 'none' : '1px solid #eef1f7',
              }}
            >
              {p.description}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
