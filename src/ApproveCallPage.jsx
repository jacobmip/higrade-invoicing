import { useState, useEffect } from "react";
import { api as apiUrl } from "./apiBase.js";

// /approve-call?token=... -- Jake answers one queued outbound call from a link
// (Telegram, Hermes, Safari, anywhere). Public route: the token is the whole
// credential, so it renders before the auth gate in App(). All reads and the
// write go through /api/approve-call; see that file for the states.

const NAVY = "#0a1628";
const ORANGE = "#E8622A";

const shell = { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: NAVY, fontFamily: "'Barlow', sans-serif" };
const card = { width: "100%", maxWidth: 400, background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" };
const row = { fontSize: 14, color: "#333", marginBottom: 10, lineHeight: 1.4, wordBreak: "break-word" };
const lab = { display: "block", fontSize: 11, fontWeight: 600, color: "#888", letterSpacing: 0.6, textTransform: "uppercase" };
const btn = (bg, color = "#fff") => ({ flex: 1, padding: "14px 10px", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, background: bg, color, cursor: "pointer" });

const ERRORS = {
  invalid_token: "Invalid or expired token.",
  closed: "Call no longer pending.",
  not_ready: "This call is not waiting for approval yet. Lisa asks right before she dials; try the link again then.",
};

export default function ApproveCallPage() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [view, setView] = useState({ phase: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/approve-call?token=${encodeURIComponent(token)}`));
        const j = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !j.ok) return setView({ phase: "error", message: ERRORS[j.error] || "Could not load this call." });
        if (j.state === "approved" || j.state === "denied") return setView({ phase: j.state, call: j.call });
        if (j.state !== "ready") return setView({ phase: "error", message: ERRORS[j.state] || "Call no longer pending.", call: j.call });
        setView({ phase: "ready", call: j.call });
      } catch {
        if (alive) setView({ phase: "error", message: "Could not reach the server. Check your connection and reload." });
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const answer = async (approval) => {
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/approve-call"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, approval }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) setView(v => ({ phase: "error", message: ERRORS[j.error] || "Could not save your answer. Try again.", call: v.call }));
      else setView(v => ({ phase: j.approval, call: v.call }));
    } catch {
      setView(v => ({ phase: "error", message: "Could not reach the server. Try again.", call: v.call }));
    }
    setBusy(false);
  };

  const call = view.call;
  const id = call?.id;
  return (
    <div style={shell}>
      <div style={card}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: NAVY, letterSpacing: 1.5 }}>HI GRADE PLUMBING</div>
          <div style={{ fontSize: 11, color: "#888", letterSpacing: 2, marginTop: 2 }}>OUTBOUND CALL APPROVAL</div>
        </div>

        {view.phase === "loading" && <div style={{ textAlign: "center", color: "#555" }}>Fetching call details...</div>}

        {call && (view.phase === "ready" || view.phase === "error") && (
          <div style={{ marginBottom: 18 }}>
            <div style={row}><span style={lab}>Call #{call.id} to</span>{call.name ? `${call.name} - ` : ""}{call.phone}</div>
            <div style={row}><span style={lab}>From</span>Lisa (HI Grade Plumbing)</div>
            <div style={row}><span style={lab}>Purpose</span>{call.purpose}</div>
            {call.context && <div style={row}><span style={lab}>She may mention</span>{call.context}</div>}
          </div>
        )}

        {view.phase === "ready" && (
          <div style={{ display: "flex", gap: 10 }}>
            <button disabled={busy} onClick={() => answer("denied")} style={btn("#e6e8ee", NAVY)}>Cancel</button>
            <button disabled={busy} onClick={() => answer("approved")} style={btn(ORANGE)}>{busy ? "Saving..." : "Approve"}</button>
          </div>
        )}

        {view.phase === "approved" && <div style={{ textAlign: "center", fontSize: 16, fontWeight: 600, color: "#1a7f37" }}>Call #{id} approved. Lisa will dial shortly, inside calling hours.</div>}
        {view.phase === "denied" && <div style={{ textAlign: "center", fontSize: 16, fontWeight: 600, color: "#b42318" }}>Call #{id} cancelled.</div>}
        {view.phase === "error" && <div style={{ textAlign: "center", fontSize: 15, color: "#b42318" }}>{view.message}</div>}
      </div>
    </div>
  );
}
