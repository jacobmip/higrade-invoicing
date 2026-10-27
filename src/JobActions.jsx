// Two compact strips for the standard invoice/estimate form, shown to
// non-admin users: Call / On My Way / Navigate on the Preview tab, and the
// clock in/out button under the tabs. Neither owns any business logic; the
// clock goes through startShift/endShift in timeclock.js, the same path the
// Time Clock tab uses.
import { useEffect, useState } from "react";
import { linesOf } from "./billTo.js";
import * as TC from "./timeclock";

const NAVY = "#0a1628";
const ORANGE = "#E8622A";
const GREEN = "#16a085";
const HEAD = "'Barlow Condensed', sans-serif";

function mapsUrl(address) {
  const q = encodeURIComponent(address);
  return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent)
    ? `https://maps.apple.com/?daddr=${q}`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

export function JobContactActions({ name, phone, jobAddress, fallbackAddress, techName }) {
  const digits = (phone || "").replace(/[^\d+]/g, "");
  const address = (linesOf(jobAddress).length ? linesOf(jobAddress) : linesOf(fallbackAddress)).join(", ");

  function onMyWay() {
    const first = (name || "").split(" ")[0] || "there";
    const body = `Aloha ${first}, this is ${techName || "your technician"} from HI Grade Plumbing. I am on my way and will arrive shortly. Mahalo!`;
    const sep = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
    window.location.href = `sms:${digits}${sep}body=${encodeURIComponent(body)}`;
  }

  const pill = (enabled) => ({
    flex: 1, boxSizing: "border-box", padding: "7px 6px", border: "none", borderRadius: 999,
    fontFamily: HEAD, fontWeight: 700, fontSize: 14, letterSpacing: 1, textTransform: "uppercase", textAlign: "center",
    textDecoration: "none", color: "#fff", background: enabled ? ORANGE : "#b9c0d0", opacity: enabled ? 1 : 0.7,
    pointerEvents: enabled ? "auto" : "none", cursor: "pointer", whiteSpace: "nowrap",
  });

  return (
    <div style={{ display: "flex", gap: 6, padding: "8px 12px 0" }}>
      <a href={digits ? `tel:${digits}` : undefined} style={pill(!!digits)}>Call</a>
      <button type="button" onClick={onMyWay} disabled={!digits} style={pill(!!digits)}>On My Way</button>
      <a href={address ? mapsUrl(address) : undefined} style={pill(!!address)}>Navigate</a>
    </div>
  );
}

export function JobClockButton({ invoice, openShift, onShiftChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const onThisJob = !!openShift && openShift.invoiceId === invoice.id;
  const onOther = !!openShift && !onThisJob;

  useEffect(() => {
    if (!onThisJob) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [onThisJob]);

  async function run(fn) {
    setErr(""); setBusy(true);
    try { onShiftChange?.(await fn()); }
    catch (e) {
      console.warn("clock failed:", e);
      setErr(e?.code === "ALREADY_CLOCKED_IN" ? "Already on the clock. Reopen the job." : "Could not save. Check your connection.");
    } finally { setBusy(false); }
  }

  const base = {
    border: "none", borderRadius: 999, padding: "5px 14px", fontFamily: HEAD, fontWeight: 700,
    fontSize: 14, letterSpacing: 1, textTransform: "uppercase", color: "#fff", cursor: "pointer", whiteSpace: "nowrap",
  };
  const mins = onThisJob ? TC.elapsedMinutes(openShift, nowMs) : 0;
  const secs = Math.floor(((onThisJob ? nowMs - new Date(openShift.clockInAt).getTime() : 0) / 1000) % 60);

  return (
    <div style={{ background: onThisJob ? "#eaf7ef" : "#f4f6fa", padding: "5px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: "1px solid #eaecf0" }}>
      <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.8, textTransform: "uppercase", color: err ? "#c0392b" : (onThisJob ? GREEN : "#7a859c"), minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {err || (onThisJob ? `${TC.fmtMinutes(Math.floor(mins))} ${String(secs).padStart(2, "0")}s on the clock` : onOther ? `Clocked in on another job · ${openShift.invoiceId || "no job"}` : "Not on the clock")}
      </span>
      {onOther
        ? <button type="button" disabled style={{ ...base, background: "#b9c0d0", cursor: "default" }}>Clocked in elsewhere</button>
        : onThisJob
        ? <button type="button" disabled={busy} onClick={() => run(async () => { await TC.endShift(openShift.id); return null; })} style={{ ...base, background: GREEN, opacity: busy ? 0.6 : 1 }}>{busy ? "Closing…" : "Clock Out"}</button>
        : <button type="button" disabled={busy} onClick={() => run(() => TC.startShift({ invoice }))} style={{ ...base, background: NAVY, opacity: busy ? 0.6 : 1 }}>{busy ? "Starting…" : "Clock In"}</button>}
    </div>
  );
}
