-- Least-privilege role used only by the local pipeline to load results.
-- It can read/write Floodograph tables and nothing else (no auth, storage or other schemas).
-- The password is NOT set here: it is applied separately as a SCRAM-SHA-256 verifier
-- generated on the developer machine, so the plaintext never leaves that machine.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'floodograph_loader') then
    create role floodograph_loader nologin noinherit;
  end if;
end $$;

grant usage on schema public, extensions to floodograph_loader;

grant select, insert, update, delete, truncate on
  public.cities, public.scenarios, public.rain_series, public.buildings, public.building_impacts,
  public.corridors, public.corridor_events, public.water_frames, public.grid_frames,
  public.impact_points, public.validation_points
to floodograph_loader;

grant usage, select on all sequences in schema public to floodograph_loader;
grant execute on all functions in schema extensions to floodograph_loader;

-- RLS is on for every table; give the loader an explicit write policy (public stays read-only).
do $$
declare t text;
begin
  foreach t in array array[
    'cities','scenarios','rain_series','buildings','building_impacts','corridors',
    'corridor_events','water_frames','grid_frames','impact_points','validation_points'
  ] loop
    execute format(
      'create policy "loader write" on public.%I for all to floodograph_loader using (true) with check (true)', t);
  end loop;
end $$;
