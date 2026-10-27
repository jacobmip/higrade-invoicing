import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";

// Employee onboarding, reached from the Supabase invite email at
// /welcome?token_hash=...&type=invite (template text lives in
// docs/invite-email-template.md). Public route: it must render before the
// auth gate in App(), because the person has no password yet.
//
// The link goes to this page, not to Supabase's /auth/v1/verify, on purpose.
// A GET against /verify consumes the one-time token, and mail scanners and link
// previewers fetch every URL in a message before the person taps it. Here the
// token is only spent when this page calls verifyOtp from the browser.

const NAVY = "#0a1628";
const ORANGE = "#E8622A";

const shell = { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: NAVY, fontFamily: "'Barlow', sans-serif" };
const card = { width: "100%", maxWidth: 400, background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" };
const label = { display: "block", fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 4, letterSpacing: 0.4 };
const input = { width: "100%", padding: "10px 12px", border: "1.5px solid #d8dbe2", borderRadius: 8, fontSize: 15, marginBottom: 14, boxSizing: "border-box", outline: "none" };

function Brand({ sub }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 22 }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: NAVY, letterSpacing: 1.5 }}>HI GRADE PLUMBING</div>
      <div style={{ fontSize: 11, color: "#888", letterSpacing: 2, marginTop: 2 }}>{sub || "LLC · HONOLULU"}</div>
    </div>
  );
}

// Turns the URL into a signed-in session. Returns { user } or { error }.
// Three shapes, in order: the template's token_hash, a PKCE ?code=, and the
// implicit-flow hash that supabase-js has already consumed by the time
// getSession() resolves (only trusted when the hash says it was an invite).
async function establishSession() {
  const q = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hashError = hash.get("error_description") || q.get("error_description");
  if (hashError) return { error: hashError.replace(/\+/g, " ") };

  const tokenHash = q.get("token_hash") || q.get("token");
  const type = q.get("type") || "invite";
  const code = q.get("code");

  let result = null;
  if (tokenHash) {
    result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  } else if (code) {
    result = await supabase.auth.exchangeCodeForSession(code);
  } else if (hash.get("type") === "invite" || hash.get("type") === "signup") {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) return { user: data.session.user };
  } else {
    return { error: "This page opens from the invite email. Tap the button in that email again." };
  }
  if (result?.error) {
    return { error: /expired|invalid/i.test(result.error.message || "")
      ? "This invite link has expired or was already used. Ask Jake to send a new one."
      : result.error.message };
  }
  const user = result?.data?.session?.user || result?.data?.user;
  return user ? { user } : { error: "Could not open your invite. Ask Jake to send a new one." };
}

export default function WelcomePage() {
  const [phase, setPhase] = useState("verifying"); // verifying | form | error
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await establishSession();
      if (!alive) return;
      // Drop the one-time token from the address bar either way.
      window.history.replaceState(null, "", "/welcome");
      if (res.error) { setError(res.error); setPhase("error"); return; }
      const md = res.user.user_metadata || {};
      // Only pre-fill a name Jake actually supplied. profiles.display_name
      // defaults to the email's local part, which is not a name.
      setName(md.full_name || md.display_name || "");
      setPhone(md.phone || "");
      setPhase("form");
    })();
    return () => { alive = false; };
  }, []);

  const submit = async (e) => {
    e?.preventDefault?.();
    setError("");
    const cleanName = name.trim();
    const digits = phone.replace(/\D/g, "");
    if (!cleanName) return setError("Enter your full name.");
    if (digits.length < 10) return setError("Enter a phone number with area code.");
    if (pw.length < 8) return setError("Password must be at least 8 characters.");
    if (pw !== pw2) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const { error: e1 } = await supabase.auth.updateUser({
        password: pw,
        data: { full_name: cleanName, display_name: cleanName, phone: phone.trim() },
      });
      if (e1) throw e1;
      // Puts the name on the roster. Migration 083; if it has not landed the
      // account still works and Jake can rename the person in Settings.
      try { await supabase.rpc("complete_my_onboarding", { p_name: cleanName }); }
      catch (err) { console.warn("complete_my_onboarding failed:", err); }
      // Full load so the app boots fresh on the new session.
      window.location.replace("/");
    } catch (err) {
      setError(err?.message || "Could not finish setting up your account.");
      setBusy(false);
    }
  };

  if (phase === "verifying") {
    return (
      <div style={shell}>
        <div style={{ color: ORANGE, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: 2 }}>HI GRADE PLUMBING</div>
        <div style={{ color: "#8899bb", fontSize: 13, marginTop: 10 }}>Opening your invite…</div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div style={shell}>
        <div style={card}>
          <Brand />
          <div style={{ background: "#fdecea", color: "#c0392b", borderRadius: 8, padding: "10px 12px", fontSize: 14, lineHeight: 1.45, marginBottom: 16 }}>{error}</div>
          <a href="/" style={{ display: "block", textAlign: "center", color: ORANGE, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>Go to sign in</a>
        </div>
      </div>
    );
  }

  const first = name.trim().split(/\s+/)[0];
  return (
    <div style={shell}>
      <div style={card}>
        <Brand />
        <div style={{ fontSize: 15, color: NAVY, lineHeight: 1.45, marginBottom: 18 }}>
          Aloha{first ? ` ${first}` : ""}, welcome to HI Grade Plumbing. Set up your account to join the team.
        </div>
        <form onSubmit={submit}>
          <label style={label}>FULL NAME</label>
          <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} style={input} />
          <label style={label}>PHONE</label>
          <input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} placeholder="(808) 555-0123" style={input} />
          <label style={label}>PASSWORD</label>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy} style={input} />
          <label style={label}>CONFIRM PASSWORD</label>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={busy} style={{ ...input, marginBottom: 18 }} />
          {error && (
            <div style={{ background: "#fdecea", color: "#c0392b", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14, lineHeight: 1.4 }}>{error}</div>
          )}
          <button type="submit" disabled={busy}
            style={{ width: "100%", padding: "12px 16px", background: ORANGE, color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, letterSpacing: 0.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
            {busy ? "JOINING…" : "JOIN THE TEAM"}
          </button>
        </form>
      </div>
    </div>
  );
}

// Shown to a signed-in person whose profiles.tier is still 'pending'. Jake
// assigns the tier in Settings; this screen notices on focus and on a slow
// poll, so nobody has to sign out and back in to get through.
export function PendingSetupScreen({ name, onRecheck, onSignOut }) {
  const [checking, setChecking] = useState(false);
  // The parent re-renders often; a ref keeps the poll from restarting each time.
  const recheckRef = useRef(onRecheck);
  recheckRef.current = onRecheck;
  const recheck = async () => {
    setChecking(true);
    try { await recheckRef.current?.(); } finally { setChecking(false); }
  };
  useEffect(() => {
    const iv = setInterval(() => { recheckRef.current?.(); }, 30000);
    const onFocus = () => { recheckRef.current?.(); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);

  const first = (name || "").trim().split(/\s+/)[0];
  return (
    <div style={shell}>
      <div style={card}>
        <Brand />
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, color: NAVY, letterSpacing: 1, marginBottom: 8 }}>PENDING SETUP</div>
        <div style={{ fontSize: 15, color: NAVY, lineHeight: 1.5, marginBottom: 20 }}>
          {first ? `Mahalo, ${first}. ` : "Mahalo. "}
          Your account is being configured. Jake will assign your role, and this screen will open the app as soon as he does.
        </div>
        <button onClick={recheck} disabled={checking}
          style={{ width: "100%", padding: "12px 16px", background: ORANGE, color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, letterSpacing: 0.5, cursor: checking ? "default" : "pointer", opacity: checking ? 0.7 : 1, marginBottom: 10 }}>
          {checking ? "CHECKING…" : "CHECK AGAIN"}
        </button>
        <button onClick={onSignOut}
          style={{ width: "100%", padding: "10px 16px", background: "#fff", color: "#778", border: "1px solid #d8dbe2", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Sign out
        </button>
        <div style={{ textAlign: "center", color: "#888", fontSize: 11, marginTop: 16 }}>Questions? Call (808) 393-0015.</div>
      </div>
    </div>
  );
}
