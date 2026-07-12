-- Edge Functions use supabase-js, so their service-role client still needs
-- explicit Data API privileges in addition to BYPASSRLS.
grant select, insert, update, delete on table
  public.profiles,
  public.classes,
  public.students,
  public.board_files,
  public.board_distributions,
  public.shared_boards
to service_role;
