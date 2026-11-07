-- Floodograph core schema: cities, scenarios, buildings, corridors, simulation outputs.
-- Read-only for the public (anon/authenticated); writes only via service_role / direct DB connection.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------- tables

create table public.cities (
  id          text primary key,
  name        text not null,
  epsg        integer not null,
  bbox        extensions.geometry(Polygon, 4326) not null,
  center      extensions.geometry(Point, 4326) not null,
  res_m       real not null default 10,
  created_at  timestamptz not null default now()
);

create table public.scenarios (
  id            text primary key,
  city_id       text not null references public.cities(id) on delete cascade,
  kind          text not null check (kind in ('historical', 'design', 'live')),
  label         text not null,
  rain_source   text not null,
  start_ts      timestamptz,
  step_min      integer not null default 5,
  duration_min  integer not null,
  total_mm      real not null default 0,
  total_m3      double precision not null default 0,
  params        jsonb not null default '{}'::jsonb,
  metrics       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index scenarios_city_idx on public.scenarios (city_id);

create table public.rain_series (
  scenario_id  text not null references public.scenarios(id) on delete cascade,
  t_min        integer not null,
  mm           real not null,
  primary key (scenario_id, t_min)
);

create table public.buildings (
  id        bigint primary key,
  city_id   text not null references public.cities(id) on delete cascade,
  osm_id    bigint,
  geom      extensions.geometry(MultiPolygon, 4326) not null,
  height_m  real not null default 9,
  hand_m    real,
  critical  text check (critical in ('hastane', 'okul', 'itfaiye', 'bakimevi'))
);
create index buildings_city_idx on public.buildings (city_id);
create index buildings_geom_idx on public.buildings using gist (geom);

create table public.building_impacts (
  scenario_id    text not null references public.scenarios(id) on delete cascade,
  building_id    bigint not null references public.buildings(id) on delete cascade,
  first_wet_min  integer,
  max_depth_m    real not null default 0,
  tier           text not null check (tier in ('acil', 'yuksek', 'orta', 'izle')),
  primary key (scenario_id, building_id)
);
create index building_impacts_building_idx on public.building_impacts (building_id);

create table public.corridors (
  id                 bigint primary key,
  city_id            text not null references public.cities(id) on delete cascade,
  geom               extensions.geometry(MultiLineString, 4326) not null,
  kind               text not null check (kind in ('buried_osm', 'derived', 'open')),
  upstream_km2       real not null default 0,
  min_hand           real,
  tier               text not null check (tier in ('acil', 'yuksek', 'orta', 'izle')),
  buildings_at_risk  integer not null default 0,
  critical_count     integer not null default 0
);
create index corridors_city_idx on public.corridors (city_id);
create index corridors_geom_idx on public.corridors using gist (geom);

create table public.corridor_events (
  scenario_id         text not null references public.scenarios(id) on delete cascade,
  corridor_id         bigint not null references public.corridors(id) on delete cascade,
  overflow_start_min  integer,
  peak_q              real,
  capacity_q          real,
  primary key (scenario_id, corridor_id)
);
create index corridor_events_corridor_idx on public.corridor_events (corridor_id);

create table public.water_frames (
  scenario_id  text not null references public.scenarios(id) on delete cascade,
  t_min        integer not null,
  band         smallint not null,
  depth_min    real not null,
  depth_max    real not null,
  geom         extensions.geometry(MultiPolygon, 4326) not null,
  primary key (scenario_id, t_min, band)
);
create index water_frames_geom_idx on public.water_frames using gist (geom);

create table public.grid_frames (
  scenario_id   text not null references public.scenarios(id) on delete cascade,
  t_min         integer not null,
  storage_path  text not null,
  max_depth     real not null default 0,
  wet_cells     integer not null default 0,
  primary key (scenario_id, t_min)
);

create table public.impact_points (
  id           bigint generated always as identity primary key,
  scenario_id  text not null references public.scenarios(id) on delete cascade,
  t_min        integer not null,
  geom         extensions.geometry(Point, 4326) not null,
  speed        real not null,
  depth        real not null
);
create index impact_points_frame_idx on public.impact_points (scenario_id, t_min);

create table public.validation_points (
  id           bigint generated always as identity primary key,
  city_id      text not null references public.cities(id) on delete cascade,
  scenario_id  text references public.scenarios(id) on delete cascade,
  name         text not null,
  geom         extensions.geometry(Point, 4326) not null,
  source_url   text,
  reported_ts  timestamptz,
  hit          boolean,
  distance_m   real
);
create index validation_points_city_idx on public.validation_points (city_id);
create index validation_points_scenario_idx on public.validation_points (scenario_id);

-- ---------------------------------------------------------------- RLS: public read-only

do $$
declare t text;
begin
  foreach t in array array[
    'cities','scenarios','rain_series','buildings','building_impacts','corridors',
    'corridor_events','water_frames','grid_frames','impact_points','validation_points'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- helpers

-- Mirrors packages/core/src/tiers.ts and pipeline/floodograph/core/tiers.py
create or replace function public.tier_from_hand(p_hand real, p_critical text)
returns text
language sql immutable
set search_path = ''
as $$
  select (array['acil','yuksek','orta','izle'])[
    greatest(1,
      (case when p_hand is null then 4
            when p_hand <= 1 then 1
            when p_hand <= 2 then 2
            when p_hand <= 3 then 3
            else 4 end)
      - (case when p_critical is not null then 1 else 0 end))
  ];
$$;

create or replace function public.scenario_json(s public.scenarios)
returns json
language sql stable
set search_path = ''
as $$
  select json_build_object(
    'id', s.id, 'cityId', s.city_id, 'kind', s.kind, 'label', s.label,
    'rainSource', s.rain_source, 'startTs', s.start_ts, 'stepMin', s.step_min,
    'durationMin', s.duration_min, 'totalMm', s.total_mm, 'totalM3', s.total_m3,
    'grid', s.params -> 'grid', 'metrics', s.metrics);
$$;

-- ---------------------------------------------------------------- RPCs (security invoker → RLS applies)

create or replace function public.get_cities()
returns json
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
    'id', c.id, 'name', c.name, 'epsg', c.epsg,
    'bbox', json_build_array(extensions.st_xmin(c.bbox), extensions.st_ymin(c.bbox),
                             extensions.st_xmax(c.bbox), extensions.st_ymax(c.bbox)),
    'center', json_build_array(extensions.st_x(c.center), extensions.st_y(c.center)),
    'resM', c.res_m) order by c.name), '[]'::json)
  from public.cities c;
$$;

create or replace function public.get_scenarios(p_city text)
returns json
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(json_agg(public.scenario_json(s) order by s.kind, s.total_mm), '[]'::json)
  from public.scenarios s where s.city_id = p_city;
$$;

create or replace function public.get_buildings(p_city text, p_scenario text default null)
returns json
language sql stable security invoker
set search_path = ''
as $$
  select json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
    'type', 'Feature',
    'id', b.id,
    'geometry', extensions.st_asgeojson(b.geom, 6)::json,
    'properties', json_build_object(
      'id', b.id, 'h', b.height_m, 'hand', b.hand_m, 'crit', b.critical,
      'fw', bi.first_wet_min, 'md', coalesce(bi.max_depth_m, 0),
      'tier', coalesce(bi.tier, public.tier_from_hand(b.hand_m, b.critical))))), '[]'::json))
  from public.buildings b
  left join public.building_impacts bi
    on bi.building_id = b.id and bi.scenario_id = p_scenario
  where b.city_id = p_city;
$$;

create or replace function public.get_water_frames(p_scenario text, p_t_from integer, p_t_to integer)
returns json
language sql stable security invoker
set search_path = ''
as $$
  select json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
    'type', 'Feature',
    'geometry', extensions.st_asgeojson(w.geom, 6)::json,
    'properties', json_build_object('t', w.t_min, 'band', w.band, 'dmin', w.depth_min, 'dmax', w.depth_max))
    order by w.t_min, w.band), '[]'::json))
  from public.water_frames w
  where w.scenario_id = p_scenario and w.t_min between p_t_from and p_t_to;
$$;

create or replace function public.get_grid_frames(p_scenario text)
returns json
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
    'tMin', g.t_min, 'path', g.storage_path, 'maxDepth', g.max_depth) order by g.t_min), '[]'::json)
  from public.grid_frames g where g.scenario_id = p_scenario;
$$;

create or replace function public.get_scenario_summary(p_scenario text)
returns json
language sql stable security invoker
set search_path = ''
as $$
  select json_build_object(
    'scenario', (select public.scenario_json(s) from public.scenarios s where s.id = p_scenario),
    'tierCounts', (
      select json_build_object(
        'acil',   count(*) filter (where bi.tier = 'acil'),
        'yuksek', count(*) filter (where bi.tier = 'yuksek'),
        'orta',   count(*) filter (where bi.tier = 'orta'),
        'izle',   count(*) filter (where bi.tier = 'izle'))
      from public.building_impacts bi where bi.scenario_id = p_scenario),
    'corridors', (
      select coalesce(json_agg(json_build_object(
        'id', c.id, 'kind', c.kind, 'tier', c.tier, 'upstreamKm2', c.upstream_km2,
        'buildingsAtRisk', c.buildings_at_risk, 'criticalCount', c.critical_count,
        'overflowStartMin', e.overflow_start_min)
        order by array_position(array['acil','yuksek','orta','izle'], c.tier),
                 c.buildings_at_risk desc), '[]'::json)
      from public.corridors c
      join public.scenarios s on s.id = p_scenario and s.city_id = c.city_id
      left join public.corridor_events e on e.corridor_id = c.id and e.scenario_id = p_scenario));
$$;

-- ---------------------------------------------------------------- storage: public-read frames bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('frames', 'frames', true, 52428800, array['application/octet-stream'])
on conflict (id) do nothing;
