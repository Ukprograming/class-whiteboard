-- Store large board images as immutable Storage objects and keep only paths in
-- board JSON. Existing data-URL snapshots remain readable by the browser.

-- Storage read policies below resolve student-owned board snapshots by path.
-- Keep that lookup indexed because it runs inside Storage RLS.
create index if not exists board_files_student_snapshot_path_idx
  on public.board_files (student_id, snapshot_path)
  where student_id is not null and snapshot_path is not null;

-- Teachers already have read access to student board rows in their classes.
-- They also need write access because the existing teacher UI can explicitly
-- save into a selected student's board folder.
drop policy if exists board_files_teacher_student_manage on public.board_files;
create policy board_files_teacher_student_manage on public.board_files
for all to authenticated
using (
  owner_kind = 'student'
  and class_id is not null
  and (select app_private.is_class_teacher(class_id))
)
with check (
  owner_kind = 'student'
  and student_id is not null
  and class_id is not null
  and (select app_private.is_class_teacher(class_id))
);

-- Match the board_files permission above at the Storage layer. This remains
-- scoped to students who belong to a class owned by the signed-in teacher.
drop policy if exists storage_board_teacher_student_manage on storage.objects;
create policy storage_board_teacher_student_manage on storage.objects
for all to authenticated
using (
  bucket_id = 'class-whiteboard'
  and exists (
    select 1
    from public.students s
    join public.classes c on c.id = s.class_id
    where c.teacher_id = (select auth.uid())
      and storage.objects.name like ('students/' || s.id::text || '/%')
  )
)
with check (
  bucket_id = 'class-whiteboard'
  and exists (
    select 1
    from public.students s
    join public.classes c on c.id = s.class_id
    where c.teacher_id = (select auth.uid())
      and storage.objects.name like ('students/' || s.id::text || '/%')
  )
);

-- A distributed board can continue to reference the teacher's immutable
-- snapshot and asset paths. Grant only the student who owns the board row
-- access to that exact snapshot and its sibling assets directory.
drop policy if exists storage_board_student_board_reference_read on storage.objects;
create policy storage_board_student_board_reference_read on storage.objects
for select to authenticated
using (
  bucket_id = 'class-whiteboard'
  and exists (
    select 1
    from public.board_files bf
    where bf.owner_kind = 'student'
      and bf.student_id = (select app_private.current_student_id())
      and bf.snapshot_path is not null
      and (
        storage.objects.name = bf.snapshot_path
        or storage.objects.name like (
          case
            when right(bf.snapshot_path, 5) = '.json'
              then left(bf.snapshot_path, length(bf.snapshot_path) - 5)
            else bf.snapshot_path
          end || '/assets/%'
        )
      )
  )
);
