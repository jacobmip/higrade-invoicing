// Header block for apprentice-tier users, rendered above the read-only Preview
// tab of the normal invoice form: who, where, when, internal notes and the
// Call / On My Way / Navigate buttons. The line items, prices and totals come
// from the Preview below it; this block adds no editing of any kind.
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
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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

export default function ApprenticeJobView({ invoice, clients, techName }) {
  const client = (clients || []).find(c => c.id === invoice.client_id)
    || (clients || []).find(c => c.name === invoice.client);
  const info = invoice.clientInfo || {};
  const name = invoice.client || client?.name || info.name || "Client";
  const phone = client?.mobile || client?.phone || info.phone || "";
  const phoneDigits = phone.replace(/[^\d+]/g, "");

  const siteLines = linesOf(invoice.jobAddress);
  const fallbackLines = [info.address1 || client?.address1, info.address2 || client?.address2, info.address3 || client?.address3].filter(Boolean);
  const address = (siteLines.length ? siteLines : fallbackLines).join(", ");

  const when = formatWhen(firstVisitStart(invoice));
  const status = STATUS_LABELS[invoice.status] || (invoice.status || "").replace(/^./, c => c.toUpperCase());

  function onMyWay() {
    const body = `Aloha, this is ${techName || "your technician"} from HI Grade Plumbing. I am on my way and will arrive shortly. Mahalo!`;
    const sep = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
    window.location.href = `sms:${phoneDigits}${sep}body=${encodeURIComponent(body)}`;
  }

  const pill = (enabled) => ({
    flex: 1, boxSizing: "border-box", padding: "8px 6px", border: "none", borderRadius: 999,
    fontFamily: HEAD, fontWeight: 700, fontSize: 15, letterSpacing: 1, textTransform: "uppercase", textAlign: "center",
    textDecoration: "none", color: "#fff", background: enabled ? ORANGE : "#b9c0d0", opacity: enabled ? 1 : 0.7,
    pointerEvents: enabled ? "auto" : "none", cursor: "pointer", whiteSpace: "nowrap",
  });
  const link = { color: "#1a5fd0", textDecoration: "none" };
  const oneLine = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <div style={{ background: LIGHT, padding: "8px 12px 6px" }}>
      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 10px", boxShadow: "0 1px 3px rgba(10,22,40,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...oneLine, flex: 1, minWidth: 0, fontFamily: HEAD, fontWeight: 700, fontSize: 20, color: NAVY, lineHeight: 1.15 }}>{name}</div>
          {status && (
            <span style={{ background: NAVY, color: "#fff", fontFamily: HEAD, fontWeight: 700, fontSize: 11, letterSpacing: 1, padding: "2px 8px", borderRadius: 999, textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0 }}>{status}</span>
          )}
        </div>
        {address && <a href={mapsUrl(address)} style={{ ...link, ...oneLine, display: "block", fontSize: 13, marginTop: 2 }}>{address}</a>}
        {(phone || when) && (
          <div style={{ ...oneLine, fontSize: 13, color: NAVY, marginTop: 1 }}>
            {phone && <a href={`tel:${phoneDigits}`} style={link}>{phone}</a>}
            {phone && when && <span style={{ color: "#aab" }}>{" · "}</span>}
            {when && <span style={{ fontWeight: 600 }}>{when}</span>}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <a href={phone ? `tel:${phoneDigits}` : undefined} style={pill(!!phone)}>Call</a>
          <button type="button" onClick={onMyWay} disabled={!phone} style={pill(!!phone)}>On My Way</button>
          <a href={address ? mapsUrl(address) : undefined} style={pill(!!address)}>Navigate</a>
        </div>
      </div>

      {invoice.internalNotes && (
        <div style={{ background: "#fff", borderRadius: 10, padding: "6px 10px", marginTop: 6, boxShadow: "0 1px 3px rgba(10,22,40,0.08)" }}>
          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#7a859c" }}>Internal job notes</div>
          <div style={{ fontSize: 14, color: NAVY, whiteSpace: "pre-wrap", lineHeight: 1.35 }}>{invoice.internalNotes}</div>
        </div>
      )}
    </div>
  );
}
