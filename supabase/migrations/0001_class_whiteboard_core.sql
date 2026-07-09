-- Class Whiteboard Supabase core schema.
-- Phase 1 covers auth-owned teachers/students, classes, file metadata,
-- storage paths, distribution records, and shared-board metadata.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('teacher', 'student')),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_code text not null unique,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classes_code_not_blank check (length(trim(class_code)) >= 4)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_login_id text not null,
  display_name text not null,
  auth_email text not null unique,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, student_login_id)
);

create table if not exists public.board_files (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('teacher', 'student')),
  teacher_id uuid references public.profiles(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  folder_path text not null default '',
  name text not null,
  snapshot_path text,
  thumbnail_path text,
  source_board_id uuid references public.board_files(id) on delete set null,
  shared_board_id uuid,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_files_owner_present check (
    (owner_kind = 'teacher' and teacher_id is not null and student_id is null)
    or
    (owner_kind = 'student' and student_id is not null)
  ),
  constraint board_files_name_not_blank check (length(trim(name)) > 0)
);

create table if not exists public.board_distributions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  source_board_id uuid not null references public.board_files(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shared_boards (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  source_board_id uuid references public.board_files(id) on delete set null,
  title text not null,
  current_snapshot_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.board_files
  drop constraint if exists board_files_shared_board_id_fkey;

alter table public.board_files
  add constraint board_files_shared_board_id_fkey
  foreign key (shared_board_id) references public.shared_boards(id) on delete set null;

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists classes_teacher_id_idx on public.classes(teacher_id);
create index if not exists classes_class_code_idx on public.classes(class_code);
create index if not exists students_auth_user_id_idx on public.students(auth_user_id);
create index if not exists students_class_id_idx on public.students(class_id);
create index if not exists students_class_login_idx on public.students(class_id, student_login_id);
create index if not exists board_files_teacher_id_idx on public.board_files(teacher_id);
create index if not exists board_files_student_id_idx on public.board_files(student_id);
create index if not exists board_files_class_id_idx on public.board_files(class_id);
create index if not exists board_files_owner_folder_idx on public.board_files(owner_kind, teacher_id, student_id, folder_path);
create index if not exists board_distributions_class_id_idx on public.board_distributions(class_id);
create index if not exists shared_boards_class_id_idx on public.shared_boards(class_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists classes_touch_updated_at on public.classes;
create trigger classes_touch_updated_at
before update on public.classes
for each row execute function public.touch_updated_at();

drop trigger if exists students_touch_updated_at on public.students;
create trigger students_touch_updated_at
before update on public.students
for each row execute function public.touch_updated_at();

drop trigger if exists board_files_touch_updated_at on public.board_files;
create trigger board_files_touch_updated_at
before update on public.board_files
for each row execute function public.touch_updated_at();

drop trigger if exists shared_boards_touch_updated_at on public.shared_boards;
create trigger shared_boards_touch_updated_at
before update on public.shared_boards
for each row execute function public.touch_updated_at();

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'teacher'
  );
$$;

create or replace function public.is_class_teacher(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.classes
    where id = target_class_id and teacher_id = (select auth.uid())
  );
$$;

create or replace function public.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.students
  where auth_user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_student_in_class(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students
    where class_id = target_class_id
      and auth_user_id = (select auth.uid())
      and active = true
  );
$$;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.board_files enable row level security;
alter table public.board_distributions enable row level security;
alter table public.shared_boards enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
for select to authenticated
using (id = (select auth.uid()));

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists classes_teacher_all on public.classes;
create policy classes_teacher_all on public.classes
for all to authenticated
using (teacher_id = (select auth.uid()))
with check (teacher_id = (select auth.uid()) and (select public.is_teacher()));

drop policy if exists classes_student_select on public.classes;
create policy classes_student_select on public.classes
for select to authenticated
using ((select public.is_student_in_class(id)));

drop policy if exists students_teacher_all on public.students;
create policy students_teacher_all on public.students
for all to authenticated
using ((select public.is_class_teacher(class_id)))
with check ((select public.is_class_teacher(class_id)));

drop policy if exists students_self_select on public.students;
create policy students_self_select on public.students
for select to authenticated
using (auth_user_id = (select auth.uid()));

drop policy if exists board_files_owner_all on public.board_files;
create policy board_files_owner_all on public.board_files
for all to authenticated
using (
  (owner_kind = 'teacher' and teacher_id = (select auth.uid()))
  or
  (owner_kind = 'student' and student_id = (select public.current_student_id()))
)
with check (
  (owner_kind = 'teacher' and teacher_id = (select auth.uid()) and student_id is null)
  or
  (owner_kind = 'student' and student_id = (select public.current_student_id()))
);

drop policy if exists board_files_teacher_class_read on public.board_files;
create policy board_files_teacher_class_read on public.board_files
for select to authenticated
using (class_id is not null and (select public.is_class_teacher(class_id)));

drop policy if exists board_distributions_teacher_read on public.board_distributions;
create policy board_distributions_teacher_read on public.board_distributions
for select to authenticated
using ((select public.is_class_teacher(class_id)));

drop policy if exists board_distributions_student_read on public.board_distributions;
create policy board_distributions_student_read on public.board_distributions
for select to authenticated
using ((select public.is_student_in_class(class_id)));

drop policy if exists shared_boards_teacher_all on public.shared_boards;
create policy shared_boards_teacher_all on public.shared_boards
for all to authenticated
using ((select public.is_class_teacher(class_id)))
with check ((select public.is_class_teacher(class_id)));

drop policy if exists shared_boards_student_read on public.shared_boards;
create policy shared_boards_student_read on public.shared_boards
for select to authenticated
using (active = true and (select public.is_student_in_class(class_id)));

insert into storage.buckets (id, name, public)
values ('class-whiteboard', 'class-whiteboard', false)
on conflict (id) do nothing;

drop policy if exists storage_board_teacher_access on storage.objects;
create policy storage_board_teacher_access on storage.objects
for all to authenticated
using (
  bucket_id = 'class-whiteboard'
  and (
    name like ('teachers/' || (select auth.uid())::text || '/%')
    or exists (
      select 1 from public.students s
      join public.classes c on c.id = s.class_id
      where c.teacher_id = (select auth.uid())
        and name like ('students/' || s.id::text || '/%')
    )
    or exists (
      select 1 from public.shared_boards sb
      where sb.teacher_id = (select auth.uid())
        and name like ('shared/' || sb.id::text || '/%')
    )
  )
)
with check (
  bucket_id = 'class-whiteboard'
  and (
    name like ('teachers/' || (select auth.uid())::text || '/%')
    or exists (
      select 1 from public.shared_boards sb
      where sb.teacher_id = (select auth.uid())
        and name like ('shared/' || sb.id::text || '/%')
    )
  )
);

drop policy if exists storage_board_student_access on storage.objects;
create policy storage_board_student_access on storage.objects
for all to authenticated
using (
  bucket_id = 'class-whiteboard'
  and (
    name like ('students/' || (select public.current_student_id())::text || '/%')
    or exists (
      select 1 from public.shared_boards sb
      join public.students s on s.class_id = sb.class_id
      where s.auth_user_id = (select auth.uid())
        and sb.active = true
        and name like ('shared/' || sb.id::text || '/%')
    )
  )
)
with check (
  bucket_id = 'class-whiteboard'
  and name like ('students/' || (select public.current_student_id())::text || '/%')
);
