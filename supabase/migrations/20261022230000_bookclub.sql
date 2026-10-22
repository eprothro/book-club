-- Book club: one round at a time. Anyone opens a one-hour window, each phone
-- submits one book, and the database picks exactly one winner when the window
-- closes (at the deadline, or as soon as every seat is filled).
--
-- Run this whole file by hand in the Supabase SQL editor. It is safe to re-run.
-- Do not run it from a deploy.
--
-- New public tables need explicit grants as of Oct 30. These tables get none
-- for anon or authenticated: row level security is on with no policies, and the
-- browser only calls the security definer functions at the bottom.
--
-- Rounds close lazily. There is no cron: the first call after the deadline
-- (any phone polling, submitting, or starting) closes the round and draws the
-- winner inside a row lock, so the draw happens once and every phone reads the
-- same result.

create schema if not exists bookclub_private;
revoke all on schema bookclub_private from public;
revoke all on schema bookclub_private from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.bookclub_rounds (
  id uuid primary key default gen_random_uuid(),
  capacity smallint not null default 6,
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  winner_pick_id uuid,
  spin_seed integer,
  constraint bookclub_rounds_capacity_chk check (capacity between 1 and 12),
  constraint bookclub_rounds_window_chk check (closes_at > opened_at),
  constraint bookclub_rounds_winner_chk check (winner_pick_id is null or closed_at is not null)
);

create table if not exists public.bookclub_picks (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.bookclub_rounds (id) on delete cascade,
  token_hash text not null,
  title text not null,
  author text,
  cover_url text,
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookclub_picks_one_per_phone unique (round_id, token_hash),
  constraint bookclub_picks_title_len check (char_length(title) between 1 and 200),
  constraint bookclub_picks_author_len check (author is null or char_length(author) between 1 and 200),
  constraint bookclub_picks_cover_chk check (cover_url is null or (char_length(cover_url) <= 500 and cover_url like 'https://%')),
  constraint bookclub_picks_key_len check (source_key is null or char_length(source_key) <= 120)
);

create table if not exists public.bookclub_rate_limits (
  bucket text primary key,
  hits integer not null,
  window_start timestamptz not null default now()
);

alter table public.bookclub_rounds drop constraint if exists bookclub_rounds_winner_fk;
alter table public.bookclub_rounds
  add constraint bookclub_rounds_winner_fk
  foreign key (winner_pick_id) references public.bookclub_picks (id) on delete set null;

create index if not exists bookclub_rounds_opened_idx on public.bookclub_rounds (opened_at desc);
create index if not exists bookclub_picks_round_idx on public.bookclub_picks (round_id);

-- At most one round is open at any moment, even if two phones tap Start together.
create unique index if not exists bookclub_rounds_one_open
  on public.bookclub_rounds ((true))
  where closed_at is null;

alter table public.bookclub_rounds enable row level security;
alter table public.bookclub_picks enable row level security;
alter table public.bookclub_rate_limits enable row level security;

revoke all on table public.bookclub_rounds from public, anon, authenticated;
revoke all on table public.bookclub_picks from public, anon, authenticated;
revoke all on table public.bookclub_rate_limits from public, anon, authenticated;

grant all on table public.bookclub_rounds to service_role;
grant all on table public.bookclub_picks to service_role;
grant all on table public.bookclub_rate_limits to service_role;

comment on table public.bookclub_rounds is 'Book club pick rounds. No direct API access; use the bookclub_* functions.';
comment on table public.bookclub_picks is 'One book per phone per round. token_hash is a SHA-256 of the phone''s token.';

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

create or replace function bookclub_private.token_hash(t text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$ select encode(sha256(convert_to(t, 'UTF8')), 'hex'); $$;

-- 244 random bits from the server's strong RNG (gen_random_uuid).
create or replace function bookclub_private.new_token()
returns text
language sql
volatile
set search_path = pg_catalog
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function bookclub_private.clean_text(p text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(regexp_replace(btrim(coalesce(p, '')), '[[:space:]]+', ' ', 'g'), '');
$$;

create or replace function bookclub_private.client_ip()
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  raw text;
  headers jsonb;
begin
  raw := current_setting('request.headers', true);
  if raw is null or btrim(raw) = '' then
    return 'unknown';
  end if;
  headers := raw::jsonb;
  raw := coalesce(headers ->> 'x-forwarded-for', headers ->> 'x-real-ip');
  if raw is null or btrim(raw) = '' then
    return 'unknown';
  end if;
  return left(btrim(split_part(raw, ',', 1)), 80);
exception when others then
  return 'unknown';
end;
$$;

create or replace function bookclub_private.allow_rate(p_action text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_ip text;
  v_limit integer;
  v_hits integer;
begin
  v_ip := bookclub_private.client_ip();
  -- Phones on one home network share an address. Unknown means the platform
  -- did not pass one, so that single bucket must not lock the club out.
  v_limit := case when v_ip = 'unknown' then greatest(p_limit, 120) else p_limit end;

  delete from public.bookclub_rate_limits
  where window_start < now() - interval '1 day';

  insert into public.bookclub_rate_limits as rl (bucket, hits, window_start)
  values (p_action || ':' || v_ip, 1, now())
  on conflict (bucket) do update
  set
    hits = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else rl.hits + 1
    end,
    window_start = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else rl.window_start
    end
  returning hits into v_hits;

  return v_hits <= v_limit;
end;
$$;

create or replace function bookclub_private.current_round_id()
returns uuid
language sql
stable
set search_path = public, pg_catalog
as $$
  select id from public.bookclub_rounds order by opened_at desc limit 1;
$$;

-- Close the round if its time is up or every seat is filled, and draw the
-- winner. The row lock makes the draw happen exactly once; a closed round is
-- never touched again.
create or replace function bookclub_private.settle(p_round uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_round public.bookclub_rounds%rowtype;
  v_count integer;
  v_winner uuid;
begin
  if p_round is null then
    return;
  end if;

  select * into v_round
  from public.bookclub_rounds
  where id = p_round
  for update;

  if not found or v_round.closed_at is not null then
    return;
  end if;

  select count(*) into v_count
  from public.bookclub_picks
  where round_id = p_round;

  if now() < v_round.closes_at and v_count < v_round.capacity then
    return;
  end if;

  select id into v_winner
  from public.bookclub_picks
  where round_id = p_round
  order by gen_random_uuid()
  limit 1;

  update public.bookclub_rounds
    set closed_at = least(now(), v_round.closes_at),
        winner_pick_id = v_winner,
        spin_seed = case when v_winner is null then null else floor(random() * 2147483647)::integer end
  where id = p_round;
end;
$$;

-- What every phone sees. While the window is open: the deadline, how many
-- are in, and this phone's own pick. Titles stay hidden until it closes.
create or replace function bookclub_private.round_json(p_round uuid, p_token text)
returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_round public.bookclub_rounds%rowtype;
  v_count integer;
  v_mine jsonb;
  v_picks jsonb;
  v_hash text;
begin
  if p_round is null then
    return null;
  end if;

  select * into v_round from public.bookclub_rounds where id = p_round;
  if not found then
    return null;
  end if;

  select count(*) into v_count from public.bookclub_picks where round_id = p_round;

  v_hash := case
    when p_token is null or btrim(p_token) = '' then null
    else bookclub_private.token_hash(btrim(p_token))
  end;

  if v_hash is not null then
    select jsonb_build_object('title', title, 'author', author, 'cover_url', cover_url, 'source_key', source_key)
      into v_mine
    from public.bookclub_picks
    where round_id = p_round and token_hash = v_hash;
  end if;

  if v_round.closed_at is not null then
    -- Ordered by the random id, so the wheel never shows who submitted first.
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'author', author, 'cover_url', cover_url
    ) order by id), '[]'::jsonb)
      into v_picks
    from public.bookclub_picks
    where round_id = p_round;
  end if;

  return jsonb_build_object(
    'id', v_round.id,
    'status', case
      when v_round.closed_at is null then 'open'
      when v_round.winner_pick_id is null then 'empty'
      else 'picked'
    end,
    'capacity', v_round.capacity,
    'count', v_count,
    'opened_at', (extract(epoch from v_round.opened_at) * 1000)::bigint,
    'closes_at', (extract(epoch from v_round.closes_at) * 1000)::bigint,
    'closed_at', (extract(epoch from v_round.closed_at) * 1000)::bigint,
    'mine', v_mine,
    'picks', v_picks,
    'winner_id', v_round.winner_pick_id,
    'spin_seed', v_round.spin_seed
  );
end;
$$;

create or replace function bookclub_private.state(p_token text)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'ok', true,
    'now', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'round', bookclub_private.round_json(bookclub_private.current_round_id(), p_token)
  );
$$;

revoke all on function bookclub_private.token_hash(text) from public, anon, authenticated;
revoke all on function bookclub_private.new_token() from public, anon, authenticated;
revoke all on function bookclub_private.clean_text(text) from public, anon, authenticated;
revoke all on function bookclub_private.client_ip() from public, anon, authenticated;
revoke all on function bookclub_private.allow_rate(text, integer, integer) from public, anon, authenticated;
revoke all on function bookclub_private.current_round_id() from public, anon, authenticated;
revoke all on function bookclub_private.settle(uuid) from public, anon, authenticated;
revoke all on function bookclub_private.round_json(uuid, text) from public, anon, authenticated;
revoke all on function bookclub_private.state(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public API (security definer; the only thing anon can call)
-- ---------------------------------------------------------------------------

-- Read the current round. Also closes it if the hour is up.
create or replace function public.bookclub_get_state(p_token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
begin
  perform bookclub_private.settle(bookclub_private.current_round_id());
  return bookclub_private.state(p_token);
end;
$$;

-- Open a one-hour window. If one is already open, this returns it instead,
-- so two phones tapping Start together land in the same round.
create or replace function public.bookclub_start_round(p_token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_current uuid;
  v_open boolean;
begin
  if not bookclub_private.allow_rate('start', 30, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;

  perform pg_advisory_xact_lock(hashtext('bookclub_start_round'));

  v_current := bookclub_private.current_round_id();
  perform bookclub_private.settle(v_current);

  select closed_at is null into v_open
  from public.bookclub_rounds
  where id = v_current;

  if coalesce(v_open, false) then
    return bookclub_private.state(p_token) || jsonb_build_object('started', false);
  end if;

  insert into public.bookclub_rounds (opened_at, closes_at)
  values (now(), now() + interval '1 hour');

  return bookclub_private.state(p_token) || jsonb_build_object('started', true);
end;
$$;

-- Submit or change this phone's pick. Without a token, a new one is issued
-- and returned; the phone keeps it in localStorage.
create or replace function public.bookclub_submit_pick(
  p_round_id uuid,
  p_title text,
  p_author text default null,
  p_cover_url text default null,
  p_source_key text default null,
  p_token text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_round public.bookclub_rounds%rowtype;
  v_token text;
  v_hash text;
  v_title text;
  v_author text;
  v_cover text;
  v_key text;
  v_mine boolean;
  v_count integer;
begin
  if not bookclub_private.allow_rate('submit', 60, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;

  v_title := bookclub_private.clean_text(p_title);
  if v_title is null or char_length(v_title) > 200 or v_title ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'error', 'title');
  end if;

  v_author := bookclub_private.clean_text(p_author);
  if v_author is not null and (char_length(v_author) > 200 or v_author ~ '[[:cntrl:]]') then
    v_author := null;
  end if;

  -- Only covers from the two lookup services; anything else becomes the
  -- drawn fallback cover rather than an error.
  v_cover := btrim(coalesce(p_cover_url, ''));
  if v_cover !~ '^https://(covers\.openlibrary\.org|books\.google\.com|books\.googleusercontent\.com)/[^[:space:]"''<>\\]*$'
    or char_length(v_cover) > 500 then
    v_cover := null;
  end if;

  v_key := bookclub_private.clean_text(p_source_key);
  if v_key is not null and (char_length(v_key) > 120 or v_key ~ '[[:cntrl:]]') then
    v_key := null;
  end if;

  if p_round_id is null or p_round_id is distinct from bookclub_private.current_round_id() then
    return bookclub_private.state(p_token) || jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  select * into v_round
  from public.bookclub_rounds
  where id = p_round_id
  for update;

  perform bookclub_private.settle(p_round_id);

  select * into v_round from public.bookclub_rounds where id = p_round_id;
  if v_round.closed_at is not null then
    return bookclub_private.state(p_token) || jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  v_token := lower(btrim(coalesce(p_token, '')));
  if v_token !~ '^[0-9a-f]{64}$' then
    v_token := bookclub_private.new_token();
  end if;
  v_hash := bookclub_private.token_hash(v_token);

  select exists (
    select 1 from public.bookclub_picks where round_id = p_round_id and token_hash = v_hash
  ) into v_mine;

  if not v_mine then
    select count(*) into v_count from public.bookclub_picks where round_id = p_round_id;
    if v_count >= v_round.capacity then
      return bookclub_private.state(v_token) || jsonb_build_object('ok', false, 'error', 'full');
    end if;
  end if;

  insert into public.bookclub_picks (round_id, token_hash, title, author, cover_url, source_key)
  values (p_round_id, v_hash, v_title, v_author, v_cover, v_key)
  on conflict (round_id, token_hash) do update
    set title = excluded.title,
        author = excluded.author,
        cover_url = excluded.cover_url,
        source_key = excluded.source_key,
        updated_at = now();

  perform bookclub_private.settle(p_round_id);

  return bookclub_private.state(v_token) || jsonb_build_object('token', v_token);
end;
$$;

revoke all on function public.bookclub_get_state(text) from public;
revoke all on function public.bookclub_start_round(text) from public;
revoke all on function public.bookclub_submit_pick(uuid, text, text, text, text, text) from public;

grant execute on function public.bookclub_get_state(text) to anon, authenticated;
grant execute on function public.bookclub_start_round(text) to anon, authenticated;
grant execute on function public.bookclub_submit_pick(uuid, text, text, text, text, text) to anon, authenticated;

comment on function public.bookclub_get_state(text) is
  'Current round. Closes it and draws the winner once the hour is up.';
comment on function public.bookclub_start_round(text) is
  'Open a one-hour round, or return the one already open.';
comment on function public.bookclub_submit_pick(uuid, text, text, text, text, text) is
  'Submit or change this phone''s book. Closes the round early when every seat is filled.';

notify pgrst, 'reload schema';
