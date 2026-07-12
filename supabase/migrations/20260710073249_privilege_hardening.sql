-- RLS is the authorization boundary; table grants are kept deliberately narrow
-- so neither anonymous nor authenticated users retain unused SQL privileges.
revoke all on table
  public.profiles,
  public.classes,
  public.students,
  public.board_files,
  public.board_distributions,
  public.shared_boards
from anon;

revoke all on table
  public.profiles,
  public.classes,
  public.students,
  public.board_files,
  public.board_distributions,
  public.shared_boards
from authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select on public.students to authenticated;
grant select, insert, update, delete on public.board_files to authenticated;
grant select on public.board_distributions to authenticated;
grant select, insert, update, delete on public.shared_boards to authenticated;

revoke all on table storage.objects from anon;
revoke all on table storage.objects from authenticated;
grant select, insert, update, delete on table storage.objects to authenticated;
