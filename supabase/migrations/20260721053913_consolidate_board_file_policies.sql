drop policy if exists board_files_teacher_student_manage on public.board_files;
drop policy if exists board_files_teacher_class_read on public.board_files;
drop policy if exists board_files_owner_all on public.board_files;

create policy board_files_owner_all
on public.board_files
for all
to authenticated
using (
  (owner_kind = 'teacher' and teacher_id = (select auth.uid()))
  or (
    owner_kind = 'student'
    and student_id = (select app_private.current_student_id())
  )
  or (
    owner_kind = 'student'
    and class_id is not null
    and (select app_private.is_class_teacher(class_id))
  )
)
with check (
  (
    owner_kind = 'teacher'
    and teacher_id = (select auth.uid())
    and student_id is null
  )
  or (
    owner_kind = 'student'
    and student_id = (select app_private.current_student_id())
  )
  or (
    owner_kind = 'student'
    and student_id is not null
    and class_id is not null
    and (select app_private.is_class_teacher(class_id))
  )
);
