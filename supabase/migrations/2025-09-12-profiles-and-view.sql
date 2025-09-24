-- Profiles + View + Indexes for memories app

-- 1) Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  accent_hex text default '#f472b6',
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Policies (use DO blocks; IF NOT EXISTS isn't valid for CREATE POLICY)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'profiles'
      and policyname = 'Public read profiles'
  ) then
    create policy "Public read profiles"
    on public.profiles
    for select
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'profiles'
      and policyname = 'Owners update profiles'
  ) then
    create policy "Owners update profiles"
    on public.profiles
    for update
    to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);
  end if;

  -- Optional: allow authenticated users to INSERT their own profile row
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'profiles'
      and policyname = 'Owners insert profiles'
  ) then
    create policy "Owners insert profiles"
    on public.profiles
    for insert
    to authenticated
    with check (auth.uid() = id);
  end if;
end
$$;

-- 2) View with author_name (drop/create to keep it idempotent)
drop view if exists public.memories_with_author;

-- Add optional manual attribution on memories table
alter table public.memories
  add column if not exists attribution_name text
  check (attribution_name in ('Hannah','Nathan','Both'));

create view public.memories_with_author as
select
  m.*,
  coalesce(m.attribution_name, p.display_name, 'Unknown') as author_name
from public.memories m
left join public.profiles p on p.id = m.created_by;

-- 3) Indexes for filters/sorting (safe when repeated)
create index if not exists memories_created_by_idx on public.memories(created_by);
create index if not exists memories_taken_at_idx   on public.memories(taken_at);
create index if not exists memories_created_at_idx on public.memories(created_at);
