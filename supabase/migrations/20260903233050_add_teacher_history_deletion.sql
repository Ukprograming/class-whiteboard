-- Delete one teacher-owned assignment distribution or form run atomically.
-- Storage objects are removed by the delete-teacher-history Edge Function
-- immediately before this service-role-only RPC is called.

create or replace function public.delete_teacher_history_records(
  p_teacher_id uuid,
  p_history_kind text,
  p_history_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted_files integer := 0;
  v_deleted_history integer := 0;
begin
  if p_teacher_id is null or p_history_id is null then
    raise exception 'Teacher ID and history ID are required';
  end if;

  if p_history_kind = 'assignment' then
    delete from public.board_files bf
    using public.board_distributions bd
    where bd.id = p_history_id
      and bd.teacher_id = p_teacher_id
      and bd.distribution_kind = 'assignment'
      and bf.distribution_id = bd.id;
    get diagnostics v_deleted_files = row_count;

    delete from public.board_distributions
    where id = p_history_id
      and teacher_id = p_teacher_id
      and distribution_kind = 'assignment';
    get diagnostics v_deleted_history = row_count;
  elsif p_history_kind = 'form' then
    delete from public.form_runs
    where id = p_history_id
      and teacher_id = p_teacher_id;
    get diagnostics v_deleted_history = row_count;
  else
    raise exception 'History kind must be assignment or form';
  end if;

  return jsonb_build_object(
    'deleted', v_deleted_history = 1,
    'deletedHistoryCount', v_deleted_history,
    'deletedBoardFileCount', v_deleted_files
  );
end;
$$;

revoke all on function public.delete_teacher_history_records(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_teacher_history_records(uuid, text, uuid)
  to service_role;
