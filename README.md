# HI Grade Plumbing – Invoicing App

## Deploy to Vercel (Step by Step)

### Step 1 – GitHub
1. Go to github.com and sign in (or create account)
2. Click the **+** button → **New repository**
3. Name it `higrade-invoicing`, make it **Private**, click **Create repository**
4. Click **uploading an existing file**
5. Drag ALL the files from this folder into the upload area
6. Click **Commit changes**

### Step 2 – Vercel
1. Go to vercel.com and sign in with your GitHub account
2. Click **Add New Project**
3. Find `higrade-invoicing` and click **Import**
4. Under **Environment Variables**, add:
   - Name: `ANTHROPIC_API_KEY` → Value: your `sk-ant-...` key
   - Name: `RESEND_API_KEY` → Value: (get free key at resend.com — needed for email)
5. Click **Deploy**
6. Wait ~60 seconds — you'll get a URL like `higrade-invoicing.vercel.app`

### Step 3 – Open on your phone
Bookmark that URL in Safari. Done — it works like a native app.

## Email Setup (Resend)
1. Go to resend.com → sign up free
2. Go to API Keys → Create API Key
3. Add it to Vercel environment variables as `RESEND_API_KEY`
4. To send from `invoices@higradeplumbing.com`, you need to verify your domain in Resend
   (they'll give you DNS records to add in your domain registrar)

## Tech Stack
- React + Vite (frontend)
- Vercel Serverless Functions (backend/API proxy)
- Anthropic Claude API (AI estimates)
- Resend (email)
- localStorage (data — Supabase DB can be added later)
