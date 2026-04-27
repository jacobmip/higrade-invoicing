# HiGrade Invoicing — Claude Instructions

## Project
React PWA invoicing app for HiGrade Plumbing LLC (Honolulu, Hawaii). Single-file app at `src/App.jsx`. Deployed on Vercel — auto-deploys on push to main.

## Rules
- After every set of code changes, always `git add`, `git commit`, and `git push` without waiting to be asked.
- A pre-push hook at `.git/hooks/pre-push` automatically backs up `src/App.jsx` to `backups/` on every push. Do not add other backup hooks or manual backup steps.
- Do not create or modify `.git/hooks/pre-commit` — it is not needed.

## Stack
- React + Vite, all UI in `src/App.jsx`
- Vercel serverless functions in `api/` (AI via Claude, email sending)
- Google Calendar integration in `src/googleCalendar.js`
- localStorage for data persistence (`KEY = "higrade_v5"`)
- Tax rate: 4.712% (Hawaii GET)
