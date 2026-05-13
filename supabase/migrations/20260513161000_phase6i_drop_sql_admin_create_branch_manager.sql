-- Phase 6i: Retire SQL-based manager creation in favor of edge-function admin API.
drop function if exists public.admin_create_branch_manager(text, text, text, uuid);
