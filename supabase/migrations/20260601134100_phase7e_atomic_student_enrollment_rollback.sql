-- Phase 7e rollback: remove atomic student enrollment RPC.

drop function if exists public.add_student_enrollment_atomic(uuid, uuid, uuid, date);
