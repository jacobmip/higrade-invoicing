import { useRef, useState } from "react";
import { supabase } from "./supabase.js";
import { api } from "./apiBase.js";

const ORANGE = "#E8622A";

function buildDestination(jobAddress) {
  if (!jobAddress) return "";
  const parts = [jobAddress.line1, jobAddress.line2, jobAddress.line3].filter(Boolean);
  return parts.join(", ");
}

function mapsUrl(address) {
  const q = encodeURIComponent(address);
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    ? `https://maps.apple.com/?daddr=${q}`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

export default function OnMyWay({ invoiceId, clientPhone, clientName, techName, jobAddress, billingAddress, onSent }) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState(null); // { ok, text }
  const sendingRef = useRef(false);
  const toastTimer = useRef(null);

  const destination = buildDestination(jobAddress) || buildDestination(billingAddress);
  const noAddress = !destination;

  function toast(text) {
    setStatus({ ok: false, text });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setStatus(null), 3000);
  }

  function handleCall() {
    const digits = (clientPhone || "").replace(/[^\d+]/g, "");
    if (!digits) { toast("No phone number on file"); return; }
    window.location.href = `tel:${digits}`;
  }

  // One tap sends. The ref locks synchronously so a double tap cannot send twice.
  // GPS is best effort: without it the server sends the "arrive shortly" wording,
  // and with it the server works out the ETA itself.
  async function handlePress() {
    if (sendingRef.current || noAddress || loading || sent) return;
    if (!invoiceId) { toast("Save the document first"); return; }
    if (!clientPhone) { toast("Client has no phone number"); return; }
    sendingRef.current = true;
    setLoading(true);
    setStatus(null);
    try {
      let coords = null;
      try {
        const pos = await new Promise((resolve, reject) => {
          if (!navigator.geolocation) return reject(new Error("no geolocation"));
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60000 });
        });
        coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch { /* no GPS: send without an ETA */ }

      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error("Signed out. Sign in again.");
      const res = await fetch(api("/api/on-my-way"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoice_id: invoiceId, ...(coords || {}) }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.code === "sms_disabled") {
        setStatus({ ok: false, text: "SMS disabled \u2014 enable in Settings" });
        return;
      }
      if (!res.ok || !out.ok) throw new Error(out.error || `Send failed (${res.status})`);
      setSent(true);
      try { onSent?.(); } catch { /* snapshot is best-effort */ }
      setStatus({
        ok: true,
        text: out.eta_minutes != null ? `Sent \u2014 ETA ${out.eta_minutes} min` : "Sent \u2014 arriving shortly",
      });
    } catch (e) {
      setStatus({ ok: false, text: String(e.message || e) });
    } finally {
      setLoading(false);
      sendingRef.current = false;
    }
  }

  const btnBase = {
    flex: 1,
    padding: "13px 10px",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: 1,
    textTransform: "uppercase",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  };

  const omwOff = loading || noAddress || sent;

  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={handleCall}
          style={{ ...btnBase, flex: "0 0 auto", padding: "13px 14px", background: "#2e8b57", cursor: "pointer", boxShadow: "0 2px 8px rgba(46,139,87,0.25)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          Call
        </button>

        <button
          type="button"
          onClick={handlePress}
          disabled={omwOff}
          title={noAddress ? "Add an address to this invoice" : undefined}
          style={{
            ...btnBase,
            background: loading || (omwOff && !sent) ? "#ccc" : sent ? "#2e8b57" : ORANGE,
            cursor: omwOff ? "default" : "pointer",
            boxShadow: omwOff ? "none" : "0 2px 8px rgba(232,98,42,0.25)",
            opacity: noAddress ? 0.4 : 1,
          }}
        >
          {loading ? "Sending…" : sent ? "Sent" : "On My Way"}
        </button>

        <button
          type="button"
          disabled={noAddress}
          title={noAddress ? "Add an address to this invoice" : "Open in Maps"}
          onClick={() => { window.location.href = mapsUrl(destination); }}
          style={{
            ...btnBase,
            flex: "0 0 auto",
            padding: "13px 14px",
            background: "#1a73e8",
            cursor: noAddress ? "default" : "pointer",
            boxShadow: noAddress ? "none" : "0 2px 8px rgba(26,115,232,0.25)",
            opacity: noAddress ? 0.4 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11"/>
          </svg>
          Navigate
        </button>
      </div>

      {status && (
        <div style={{ marginTop: 6, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 0.5, color: status.ok ? "#2e8b57" : "#c0392b" }}>
          {status.text}
        </div>
      )}

    </div>
  );
}
