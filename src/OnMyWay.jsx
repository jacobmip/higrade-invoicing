import { useState } from "react";

const ORANGE = "#E8622A";

function buildDestination(jobAddress) {
  if (!jobAddress) return "";
  const parts = [jobAddress.line1, jobAddress.line2, jobAddress.line3].filter(Boolean);
  return parts.join(", ");
}

export default function OnMyWay({ clientName, clientPhone, jobAddress }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function openSms(etaMinutes) {
    const name = clientName || "there";
    const body = etaMinutes != null
      ? `Hi ${name}, this is Jake from HI Grade Plumbing. I'm on my way and should arrive in approximately ${etaMinutes} minutes. See you soon!`
      : `Hi ${name}, this is Jake from HI Grade Plumbing. I'm on my way! See you soon!`;
    const phone = (clientPhone || "").replace(/\D/g, "");
    window.location.href = `sms:${phone}&body=${encodeURIComponent(body)}`;
  }

  async function handlePress() {
    if (error) {
      openSms(null);
      return;
    }

    const destination = buildDestination(jobAddress);

    if (!clientPhone || !destination) {
      setError(`missing: ${!clientPhone ? "phone " : ""}${!destination ? "address" : ""} — tap to send`);
      return;
    }

    setLoading(true);
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      const { latitude, longitude } = pos.coords;
      const res = await fetch(`/api/eta?origin=${latitude},${longitude}&destination=${encodeURIComponent(destination)}`);
      const data = await res.json();
      if (data.minutes) {
        openSms(data.minutes);
      } else {
        setError(`${JSON.stringify(data)} — tap to send`);
      }
    } catch (err) {
      setError(`${err?.message || err} — tap to send`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handlePress}
      disabled={loading}
      style={{
        width: "100%",
        padding: "13px 16px",
        background: loading ? "#ccc" : ORANGE,
        color: "#fff",
        border: "none",
        borderRadius: 10,
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        fontSize: 16,
        letterSpacing: 1,
        textTransform: "uppercase",
        cursor: loading ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        boxShadow: loading ? "none" : "0 2px 8px rgba(232,98,42,0.25)",
      }}
    >
      {error || (loading ? "Getting ETA…" : "On My Way")}
    </button>
  );
}
