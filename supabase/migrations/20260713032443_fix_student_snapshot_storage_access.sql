-- Let teachers read realtime snapshots for students in their own classes.
--
-- The original policy used an unqualified `name` inside a classes join. PostgreSQL
-- resolved it as classes.name instead of storage.objects.name, so every teacher
-- download of students/{student_id}/realtime/{class_id}.json was denied.
--
-- Split read-only cross-owner access from owner write access so teachers cannot
-- modify/delete student files and students cannot modify/delete shared files.

drop policy if exists storage_board_teacher_access on storage.objects;
drop policy if exists storage_board_teacher_student_read on storage.objects;
drop policy if exists storage_board_student_access on storage.objects;
drop policy if exists storage_board_student_shared_read on storage.objects;

create policy storage_board_teacher_access on storage.objects
for all to authenticated
using (
  bucket_id = 'class-whiteboard'
  and (
    storage.objects.name like ('teachers/' || (select auth.uid())::text || '/%')
    or exists (
      select 1
      from public.shared_boards sb
      where sb.teacher_id = (select auth.uid())
        and storage.objects.name like ('shared/' || sb.id::text || '/%')
    )
  )
)
with check (
  bucket_id = 'class-whiteboard'
  and (
    storage.objects.name like ('teachers/' || (select auth.uid())::text || '/%')
    or exists (
      select 1
      from public.shared_boards sb
      where sb.teacher_id = (select auth.uid())
        and storage.objects.name like ('shared/' || sb.id::text || '/%')
    )
  )
);

create policy storage_board_teacher_student_read on storage.objects
for select to authenticated
using (
  bucket_id = 'class-whiteboard'
  and exists (
    select 1
    from public.students s
    join public.classes c on c.id = s.class_id
    where c.teacher_id = (select auth.uid())
      and storage.objects.name like ('students/' || s.id::text || '/%')
  )
);

create policy storage_board_student_access on storage.objects
for all to authenticated
using (
  bucket_id = 'class-whiteboard'
  and storage.objects.name like (
    'students/' || (select app_private.current_student_id())::text || '/%'
  )
)
with check (
  bucket_id = 'class-whiteboard'
  and storage.objects.name like (
    'students/' || (select app_private.current_student_id())::text || '/%'
  )
);

create policy storage_board_student_shared_read on storage.objects
for select to authenticated
using (
  bucket_id = 'class-whiteboard'
  and exists (
    select 1
    from public.shared_boards sb
    join public.students s on s.class_id = sb.class_id
    where s.auth_user_id = (select auth.uid())
      and sb.active = true
      and storage.objects.name like ('shared/' || sb.id::text || '/%')
  )
);
