-- Store simulation frames (zstd-compressed depth/u/v, see packages/core/src/frames.ts) in Postgres instead of
-- Storage: the loader role can write them without the service_role key, and the public reads them through an
-- RPC that PostgREST serves as raw binary (Accept: application/octet-stream).

alter table public.grid_frames add column if not exists data bytea;

create or replace function public.get_grid_frame(p_scenario text, p_t integer)
returns bytea
language sql stable security invoker
set search_path = ''
as $$
  select g.data from public.grid_frames g where g.scenario_id = p_scenario and g.t_min = p_t;
$$;

grant execute on function public.get_grid_frame(text, integer) to anon, authenticated;
