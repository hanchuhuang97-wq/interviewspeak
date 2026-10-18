-- Run this once in Supabase > SQL Editor.
-- Unit content + generated audio bucket + teacher-only writes.

create extension if not exists pgcrypto;

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  title_zh text,
  sentences jsonb not null default '[]'::jsonb,
  challenge jsonb,
  active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.units enable row level security;

create or replace function public.is_teacher()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher', false);
$$;

drop policy if exists "students read active units" on public.units;
create policy "students read active units"
on public.units for select
to authenticated
using (active or public.is_teacher());

drop policy if exists "teachers insert units" on public.units;
create policy "teachers insert units"
on public.units for insert
to authenticated
with check (public.is_teacher());

drop policy if exists "teachers update units" on public.units;
create policy "teachers update units"
on public.units for update
to authenticated
using (public.is_teacher())
with check (public.is_teacher());

drop policy if exists "teachers delete units" on public.units;
create policy "teachers delete units"
on public.units for delete
to authenticated
using (public.is_teacher());

create unique index if not exists units_single_active
on public.units ((active))
where active;

-- Public-read audio bucket; only teachers can upload/update/delete.
insert into storage.buckets (id, name, public)
values ('unit-audio', 'unit-audio', true)
on conflict (id) do update set public = true;

drop policy if exists "public read unit audio" on storage.objects;
create policy "public read unit audio"
on storage.objects for select
using (bucket_id = 'unit-audio');

drop policy if exists "teachers upload unit audio" on storage.objects;
create policy "teachers upload unit audio"
on storage.objects for insert
to authenticated
with check (bucket_id = 'unit-audio' and public.is_teacher());

drop policy if exists "teachers update unit audio" on storage.objects;
create policy "teachers update unit audio"
on storage.objects for update
to authenticated
using (bucket_id = 'unit-audio' and public.is_teacher())
with check (bucket_id = 'unit-audio' and public.is_teacher());

drop policy if exists "teachers delete unit audio" on storage.objects;
create policy "teachers delete unit audio"
on storage.objects for delete
to authenticated
using (bucket_id = 'unit-audio' and public.is_teacher());

-- Promote one account to teacher (run after creating the user).
-- Replace the email with the teacher's synthetic or real email.
-- update auth.users
-- set raw_app_meta_data =
--   coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"teacher"}'::jsonb
-- where email = 'huanglaoshi@students.winnie-garden.app';
--
-- The teacher must sign out and back in afterwards so the JWT carries the role.
