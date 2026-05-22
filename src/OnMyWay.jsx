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

  const destination = buildDestination(jobAddress);
  const noAddress = !destination;

  function openSms(etaMinutes) {
    const firstName = (clientName || "").split(" ")[0] || "there";
    const body = etaMinutes != null
      ? `Aloha ${firstName}, this is Jake from HI Grade Plumbing. I'm on my way and should arrive in approximately ${etaMinutes} minutes. See you soon!`
      : `Aloha ${firstName}, this is Jake from HI Grade Plumbing. I'm on my way! See you soon!`;
    const phone = (clientPhone || "").replace(/\D/g, "");
    window.location.href = `sms:${phone}&body=${encodeURIComponent(body)}`;
  }

  async function handlePress() {
    if (noAddress) return;

    if (error) {
      openSms(null);
      return;
    }

    if (!clientPhone) {
      openSms(null);
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
        setError("Could not get ETA — tap to send anyway");
      }
    } catch {
      setError("Location unavailable — tap to send anyway");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handlePress}
      disabled={loading || noAddress}
      title={noAddress ? "Add an address to this invoice" : undefined}
      style={{
        width: "100%",
        padding: "13px 16px",
        background: (loading || noAddress) ? "#ccc" : ORANGE,
        color: "#fff",
        border: "none",
        borderRadius: 10,
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        fontSize: 16,
        letterSpacing: 1,
        textTransform: "uppercase",
        cursor: (loading || noAddress) ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        boxShadow: (loading || noAddress) ? "none" : "0 2px 8px rgba(232,98,42,0.25)",
      }}
    >
      {error || (loading ? "Getting ETA…" : "On My Way")}
    </button>
  );
}
