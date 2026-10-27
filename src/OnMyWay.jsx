import { useState } from "react";
import { supabase } from "./supabase.js";
import { api } from "./apiBase.js";

const ORANGE = "#E8622A";

function buildDestination(jobAddress) {
  if (!jobAddress) return "";
  const parts = [jobAddress.line1, jobAddress.line2, jobAddress.line3].filter(Boolean);
  return parts.join(", ");
}

export default function OnMyWay({ invoiceId, clientPhone, jobAddress, billingAddress, onSent }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // { ok, text }

  const destination = buildDestination(jobAddress) || buildDestination(billingAddress);
  const noAddress = !destination;

  async function handlePress() {
    if (noAddress || loading) return;
    if (!invoiceId) { setStatus({ ok: false, text: "Save the document first" }); return; }
    if (!clientPhone) { setStatus({ ok: false, text: "Client has no phone number" }); return; }

    setLoading(true);
    setStatus(null);
    try {
      // GPS denied or slow is not fatal: the server sends the "arrive shortly" wording.
      let coords = {};
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
        );
        coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch { /* fall back to no ETA */ }

      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error("Signed out. Sign in again.");
      const res = await fetch(api("/api/on-my-way"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoice_id: invoiceId, ...coords }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.code === "sms_disabled") {
        setStatus({ ok: false, text: "SMS disabled \u2014 enable in Settings" });
        return;
      }
      if (!res.ok || !out.ok) throw new Error(out.error || `Send failed (${res.status})`);
      try { onSent?.(); } catch { /* snapshot is best-effort */ }
      setStatus({
        ok: true,
        text: out.eta_minutes != null ? `Message sent \u2014 ETA ${out.eta_minutes} min` : "Message sent \u2014 arriving shortly",
      });
    } catch (e) {
      setStatus({ ok: false, text: String(e.message || e) });
    } finally {
      setLoading(false);
    }
  }

  const btnBase = {
    flex: 1,
    padding: "13px 16px",
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

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        onClick={handlePress}
        disabled={loading || noAddress}
        title={noAddress ? "Add an address to this invoice" : undefined}
        style={{
          ...btnBase,
          background: loading ? "#ccc" : status?.ok ? "#2e8b57" : ORANGE,
          cursor: loading || noAddress ? "default" : "pointer",
          boxShadow: loading || noAddress ? "none" : "0 2px 8px rgba(232,98,42,0.25)",
          opacity: noAddress ? 0.4 : 1,
        }}
      >
        {loading ? "Sending…" : status?.text || "On My Way"}
      </button>

      <button
        type="button"
        disabled={noAddress}
        title={noAddress ? "Add an address to this invoice" : "Open in Google Maps"}
        onClick={() => {
          window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
        }}
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
  );
}
