# Memories - photo album (legacy + new import)

This repo contains an older static scrapbook (`index.html`) and a new import flow that can upload old memories into a Supabase `memories` bucket and `public.memories` table.

Quick setup

1. Copy `.env.example` to `.env` and fill values (DO NOT commit `.env`).
2. Generate hashed password for the old-import gate:

```
node make_hash.js 'your-secret-password'
```

Copy `OLD_MEM_PW_SALT` and `OLD_MEM_PW_HASH` into `.env`.

3. Install Vercel CLI and run locally:

```
npm i -g vercel
vercel dev
```

4. Open http://localhost:3000. The site will ask for a password; after entering it, the "Add old memory" button appears.

Files added

- `api/verify-password.js` - POST {password} → sets cookie if valid.
- `api/import-old-memory.js` - POST {title,note,taken_at,imageBase64,filename} → uploads to Supabase storage and inserts row in `public.memories` using the service role key.
- `make_hash.js` - helper to generate salt+hash.
- `.env.example` - env variables list.
- `lib/session.js` / `api/session-check.js` - signed session cookies used by the password gate and checked by the front-end guard.

Env vars required (set these locally and in Vercel):

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY  (keep secret)
- IMPORTER_USER_ID           (UUID for created_by field)
- OLD_MEM_PW_SALT            (base64 from make_hash.js)
- OLD_MEM_PW_HASH            (base64 from make_hash.js)
- SESSION_SECRET             (random 32+ char string for signing session cookies)
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

Supabase SQL

```sql
-- Enable pgcrypto for gen_random_uuid()
create extension if not exists pgcrypto;

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  title text,
  note text,
  image_url text not null,
  taken_at date,
  is_private boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

alter table public.memories enable row level security;

-- Public can read public memories
create policy "Public read public memories"
on public.memories
for select
using (is_private = false);

-- Owners can read their own memories
create policy "Owners read"
on public.memories
for select
to authenticated
using (auth.uid() = created_by);

-- Authenticated users can insert their own memories
create policy "Owners insert"
on public.memories
for insert
to authenticated
with check (auth.uid() = created_by);

-- Owners can update/delete their memories
create policy "Owners update"
on public.memories
for update
to authenticated
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

create policy "Owners delete"
on public.memories
for delete
to authenticated
using (auth.uid() = created_by);
```

Local dev notes

- `vercel dev` will load `.env` and serve the `api/` endpoints. The `verify-password` endpoint sets an HttpOnly cookie and `import-old-memory` requires that cookie.
- Keep the `SUPABASE_SERVICE_ROLE_KEY` secret — only define it in your `.env` and Vercel project settings.

## Good Morning feature

- New page: `good-morning.html` to configure recipient email, push, category (Funny/Loving/Playful), delivery time and timezone, add messages, and view history.
- APIs:
  - `api/gm-save-settings.js` (GET/POST)
  - `api/gm-messages.js` (GET/POST)
  - `api/gm-list-history.js` (GET)
  - `api/gm-subscribe.js` (POST)
  - `api/gm-cron.js` (invoked by Vercel cron every 5 minutes)
- Schema: see `sql/migrations/2025-09-14-good-morning.sql` for tables `good_morning_settings`, `good_morning_messages`, `good_morning_history`.
- Push worker: `gm-sw.js`.

Environment variables required:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- For email sending, wire `api/gm-cron.js` to your provider (Resend, SendGrid, SES). Placeholders are left where to call.
- For web push, generate VAPID keys; expose public key to the page (e.g., inject via script), and send payloads server-side.

Notes:
- The cron uses an approximate timezone conversion without a library; for production, consider using a tz-aware library.
fun html project
