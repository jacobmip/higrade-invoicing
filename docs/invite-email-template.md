# Employee invite email (Supabase dashboard, paste-in)

Where: https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/auth/templates -> **Invite user**.

Also check once, under Authentication -> URL Configuration:
- **Site URL** = `https://higrade-invoicing.vercel.app` (the template builds the link from it).
- Redirect URLs does not need `/welcome`: the link goes straight to the app, not through Supabase's `/verify`.

Why the link is built by hand: a normal `{{ .ConfirmationURL }}` is spent by the first GET, and mail scanners
GET every link. This link only carries the token to `/welcome`, which spends it with `verifyOtp` in the browser.

**Subject:** Aloha from HI Grade Plumbing - set up your account

**Message body (HTML):**

```html
<div style="background:#0a1628;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table align="center" width="100%" style="max-width:480px;background:#ffffff;border-radius:14px;" cellpadding="0" cellspacing="0">
    <tr><td style="padding:28px 32px 8px;text-align:center;">
      <div style="font-size:24px;font-weight:800;letter-spacing:1.5px;color:#0a1628;">HI GRADE PLUMBING</div>
      <div style="font-size:11px;letter-spacing:2px;color:#888888;margin-top:2px;">LLC &middot; HONOLULU</div>
    </td></tr>
    <tr><td style="padding:16px 32px 4px;color:#0a1628;font-size:16px;line-height:1.5;">
      <p style="margin:0 0 14px;">Aloha{{ if .Data.full_name }} {{ .Data.full_name }}{{ end }},</p>
      <p style="margin:0 0 14px;">Welcome to HI Grade Plumbing. Tap the button below to set up your account.</p>
    </td></tr>
    <tr><td style="padding:8px 32px 20px;text-align:center;">
      <a href="{{ .SiteURL }}/welcome?token_hash={{ .TokenHash }}&type=invite"
         style="display:inline-block;background:#E8622A;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.5px;padding:14px 32px;border-radius:8px;">
        Set Up My Account
      </a>
    </td></tr>
    <tr><td style="padding:0 32px 28px;color:#555555;font-size:14px;line-height:1.5;">
      <p style="margin:0 0 14px;">Mahalo,<br>Jake Petersen<br>HI Grade Plumbing LLC</p>
      <p style="margin:0;font-size:12px;color:#888888;">Button not working? Copy this link into your browser:<br>
      {{ .SiteURL }}/welcome?token_hash={{ .TokenHash }}&type=invite</p>
    </td></tr>
  </table>
</div>
```

**Plain text (for clients that do not render HTML):**

```
Aloha{{ if .Data.full_name }} {{ .Data.full_name }}{{ end }},

Welcome to HI Grade Plumbing. Open this link to set up your account:

{{ .SiteURL }}/welcome?token_hash={{ .TokenHash }}&type=invite

Mahalo,
Jake Petersen
HI Grade Plumbing LLC
```

## Notes
- The name appears only if the invite carried `full_name` in its user metadata. The dashboard's Invite button
  cannot set metadata, so a dashboard invite reads "Aloha," and the person types their name on /welcome.
  An API invite (`auth.admin.inviteUserByEmail(email, { data: { full_name } })`) pre-fills both.
- The invite link expires with the project's OTP expiry (Authentication -> Providers -> Email). Re-invite if it lapses.
- The sender is whatever SMTP Supabase is using. The built-in sender is rate limited and may land in spam; custom SMTP via Resend (already used for invoices) fixes both.
