# Kickstart Accounts

Multi-tenant sports academy billing app built with React + Vite + Supabase.

## Tech Stack

- React 19 + Vite
- TypeScript
- Supabase (Auth + Postgres + RLS)
- Vercel (frontend hosting)

## Local Development

Prerequisites:
- Node.js 20+
- npm

Steps:
1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local`.
3. Set at minimum:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Start app:
   `npm run dev`

## Required Environment Variables

Frontend (safe to expose in browser):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL`

Server/ops only (never expose to browser bundles):
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`

## Deploy to Vercel

1. Import the repository in Vercel.
2. Framework preset: `Vite`.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Add environment variables in Vercel Project Settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_URL`
6. Deploy.

SPA routing is already handled in [vercel.json](vercel.json).

## Pre-Deploy Verification

Run before every release:
- `npm run lint`
- `npm run build`

## Security Notes

- Do not commit real credentials in `.env.example` or tracked files.
- Never put `SUPABASE_SERVICE_ROLE_KEY` in client-side code or `VITE_*` variables.
- Keep RLS enabled in Supabase for all tenant-scoped tables.
