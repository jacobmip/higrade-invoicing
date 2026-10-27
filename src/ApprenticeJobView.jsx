// Simplified job screen for apprentice-tier users: who, where, when, notes and
// three buttons. Deliberately shows nothing financial: no line items, prices,
// totals, tax, payments, signature or edit controls.
import { linesOf } from "./billTo.js";

const NAVY = "#0a1628";
const ORANGE = "#E8622A";
const LIGHT = "#f4f6fa";
const HEAD = "'Barlow Condensed', sans-serif";

const STATUS_LABELS = {
  outstanding: "Open", partial: "Open", net30: "Open", paid: "Completed",
  approved: "Approved", draft: "Draft", sent: "Sent", declined: "Declined",
};

// gcal_date / visits[].start are local wall-clock text, YYYY-MM-DDTHH:MM.
// Parse the pieces by hand so no timezone is applied.
function formatWhen(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text || "");
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function firstVisitStart(inv) {
  const starts = (inv.visits || []).map(v => v?.start).filter(Boolean).sort();
  return starts[0] || inv.gcalDate || "";
}

function mapsUrl(address) {
  const q = encodeURIComponent(address);
  return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent)
    ? `https://maps.apple.com/?daddr=${q}`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

export default function ApprenticeJobView({ invoice, clients, techName, onBack }) {
  const client = (clients || []).find(c => c.id === invoice.client_id)
    || (clients || []).find(c => c.name === invoice.client);
  const info = invoice.clientInfo || {};
  const name = invoice.client || client?.name || info.name || "Client";
  const phone = client?.mobile || client?.phone || info.phone || "";
  const phoneDigits = phone.replace(/[^\d+]/g, "");

  const siteLines = linesOf(invoice.jobAddress);
  const fallbackLines = [info.address1 || client?.address1, info.address2 || client?.address2, info.address3 || client?.address3].filter(Boolean);
  const addressLines = siteLines.length ? siteLines : fallbackLines;
  const address = addressLines.join(", ");

  const jobTitle = (invoice.items || []).map(i => i?.name).find(Boolean)
    || (invoice.type === "estimate" ? "Estimate visit" : "Service call");
  const when = formatWhen(firstVisitStart(invoice));
  const status = STATUS_LABELS[invoice.status] || (invoice.status || "").replace(/^./, c => c.toUpperCase());

  function onMyWay() {
    const body = `Aloha, this is ${techName || "your technician"} from HI Grade Plumbing. I am on my way and will arrive shortly. Mahalo!`;
    const sep = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
    window.location.href = `sms:${phoneDigits}${sep}body=${encodeURIComponent(body)}`;
  }

  const card = { background: "#fff", borderRadius: 12, padding: 16, margin: "12px 16px 0", boxShadow: "0 1px 3px rgba(10,22,40,0.08)" };
  const label = { fontFamily: HEAD, fontWeight: 700, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "#7a859c", marginBottom: 6 };
  const action = (enabled) => ({
    display: "block", width: "100%", boxSizing: "border-box", padding: "18px 16px", border: "none", borderRadius: 12,
    fontFamily: HEAD, fontWeight: 700, fontSize: 22, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center",
    textDecoration: "none", color: "#fff", background: enabled ? ORANGE : "#b9c0d0", opacity: enabled ? 1 : 0.7,
    pointerEvents: enabled ? "auto" : "none", cursor: "pointer",
  });

  return (
    <div style={{ minHeight: "100%", background: LIGHT, paddingBottom: 32 }}>
      <div style={{ background: NAVY, color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#fff", fontFamily: HEAD, fontWeight: 700, fontSize: 18, letterSpacing: 1, cursor: "pointer", padding: 4 }}>&lsaquo; BACK</button>
      </div>

      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 26, color: NAVY, lineHeight: 1.15 }}>{jobTitle}</div>
        {status && <span style={{ background: NAVY, color: "#fff", fontFamily: HEAD, fontWeight: 700, fontSize: 13, letterSpacing: 1, padding: "4px 10px", borderRadius: 999, textTransform: "uppercase", whiteSpace: "nowrap" }}>{status}</span>}
      </div>

      <div style={card}>
        <div style={label}>Client</div>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 30, color: NAVY, lineHeight: 1.1 }}>{name}</div>
        {address && (
          <a href={mapsUrl(address)} style={{ display: "block", marginTop: 10, color: "#1a5fd0", fontSize: 17, textDecoration: "none" }}>
            {addressLines.map((l, i) => <div key={i}>{l}</div>)}
          </a>
        )}
        {phone && <a href={`tel:${phoneDigits}`} style={{ display: "block", marginTop: 10, color: "#1a5fd0", fontSize: 19, textDecoration: "none" }}>{phone}</a>}
      </div>

      {when && (
        <div style={card}>
          <div style={label}>Scheduled</div>
          <div style={{ fontSize: 18, color: NAVY, fontWeight: 600 }}>{when}</div>
        </div>
      )}

      {invoice.internalNotes && (
        <div style={card}>
          <div style={label}>Job notes</div>
          <div style={{ fontSize: 16, color: NAVY, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{invoice.internalNotes}</div>
        </div>
      )}

      <div style={{ margin: "16px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        <a href={phone ? `tel:${phoneDigits}` : undefined} style={action(!!phone)}>Call</a>
        <button type="button" onClick={onMyWay} disabled={!phone} style={action(!!phone)}>On My Way</button>
        <a href={address ? mapsUrl(address) : undefined} style={action(!!address)}>Navigate</a>
      </div>
    </div>
  );
}
