-- Phase 6c: Branch image support for super-admin branch creation form
alter table public.branches
add column if not exists image text;
