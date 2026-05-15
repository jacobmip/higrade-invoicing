import { useState } from "react";

const ORANGE = "#E8622A";
const NAVY = "#0a1628";

function buildDestination(jobAddress) {
  if (!jobAddress) return "";
  const parts = [jobAddress.line1, jobAddress.line2, jobAddress.line3].filter(Boolean);
  return parts.join(", ");
}

export default function OnMyWay({ clientName, clientPhone, jobAddress }) {
  const [loading, setLoading] = useState(false);

  function openSms(etaMinutes) {
    const name = clientName || "there";
    const body = etaMinutes != null
      ? `Hi ${name}, this is Jake from HI Grade Plumbing. I'm on my way and should arrive in approximately ${etaMinutes} minutes. See you soon!`
      : `Hi ${name}, this is Jake from HI Grade Plumbing. I'm on my way! See you soon!`;
    const phone = (clientPhone || "").replace(/\D/g, "");
    window.location.href = `sms:${phone}&body=${encodeURIComponent(body)}`;
  }

  async function handlePress() {
    if (!clientPhone) {
      openSms(null);
      return;
    }

    const destination = buildDestination(jobAddress);
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!destination || !apiKey) {
      openSms(null);
      return;
    }

    setLoading(true);
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      const { latitude, longitude } = pos.coords;
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${latitude},${longitude}&destinations=${encodeURIComponent(destination)}&key=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json();
      const element = data?.rows?.[0]?.elements?.[0];
      if (element?.status === "OK" && element?.duration?.value) {
        const minutes = Math.round(element.duration.value / 60);
        openSms(minutes);
      } else {
        openSms(null);
      }
    } catch {
      openSms(null);
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
      {loading ? "Getting ETA…" : "On My Way"}
    </button>
  );
}
