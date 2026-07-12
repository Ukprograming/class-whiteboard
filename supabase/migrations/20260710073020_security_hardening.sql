-- Harden the test project before any teacher or student accounts are created.
-- This migration is safe to apply to an empty project and remains valid once
-- classroom data exists.

-- Do not let a user turn their own profile into a teacher profile.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and role = (
    select p.role
    from public.profiles p
    where p.id = (select auth.uid())
  )
);

-- Give browser clients only the table operations that the app uses. RLS still
-- determines which rows a signed-in user can access.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select on public.students to authenticated;
grant select, insert, update, delete on public.board_files to authenticated;
grant select on public.board_distributions to authenticated;
grant select, insert, update, delete on public.shared_boards to authenticated;

-- Keep the RLS helpers out of the exposed public schema. They remain callable
-- by authenticated RLS evaluation, but cannot be invoked as public RPCs.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

alter function public.is_teacher() set schema app_private;
alter function public.is_class_teacher(uuid) set schema app_private;
alter function public.current_student_id() set schema app_private;
alter function public.is_student_in_class(uuid) set schema app_private;
drop function if exists public.current_profile_role();

alter function app_private.is_teacher() set search_path = public, pg_catalog;
alter function app_private.is_class_teacher(uuid) set search_path = public, pg_catalog;
alter function app_private.current_student_id() set search_path = public, pg_catalog;
alter function app_private.is_student_in_class(uuid) set search_path = public, pg_catalog;

revoke all on function app_private.is_teacher() from public;
revoke all on function app_private.is_class_teacher(uuid) from public;
revoke all on function app_private.current_student_id() from public;
revoke all on function app_private.is_student_in_class(uuid) from public;
grant execute on function app_private.is_teacher() to authenticated;
grant execute on function app_private.is_class_teacher(uuid) to authenticated;
grant execute on function app_private.current_student_id() to authenticated;
grant execute on function app_private.is_student_in_class(uuid) to authenticated;

-- The trigger function does not need a mutable search path.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- A prior dashboard experiment added this event-trigger helper directly in the
-- project. It is never intended to be a browser RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public;
  end if;
end;
$$;

-- Low-cost indexes for the foreign keys reported by the project advisor.
create index if not exists students_created_by_idx on public.students(created_by);
create index if not exists board_files_source_board_id_idx on public.board_files(source_board_id);
create index if not exists board_files_shared_board_id_idx on public.board_files(shared_board_id);
create index if not exists board_distributions_teacher_id_idx on public.board_distributions(teacher_id);
create index if not exists board_distributions_source_board_id_idx on public.board_distributions(source_board_id);
create index if not exists shared_boards_teacher_id_idx on public.shared_boards(teacher_id);
create index if not exists shared_boards_source_board_id_idx on public.shared_boards(source_board_id);
