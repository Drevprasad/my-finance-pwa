-- Dad sharing: lite read-only sharing of a user's lite data with a viewer.
-- Money is always stored as integer paise in *_minor columns.

-- ---------------------------------------------------------------------------
-- user_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.user_profiles (
  user_id       uuid primary key default auth.uid()
    references auth.users(id) on delete cascade,
  display_name  text not null,
  ui_mode       text not null default 'full'
    check (ui_mode in ('full', 'lite')),
  created_at    timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;

-- ---------------------------------------------------------------------------
-- lite_shares
-- ---------------------------------------------------------------------------
create table if not exists public.lite_shares (
  id          bigint primary key generated always as identity,
  owner_id    uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  viewer_id   uuid not null
    references auth.users(id) on delete cascade,
  role        text not null default 'viewer'
    check (role in ('viewer')),
  created_at  timestamptz not null default now(),
  constraint lite_shares_owner_viewer_key unique (owner_id, viewer_id),
  constraint lite_shares_owner_ne_viewer check (owner_id <> viewer_id)
);

alter table public.lite_shares enable row level security;
alter table public.lite_shares force row level security;

-- ---------------------------------------------------------------------------
-- lite_categories
-- ---------------------------------------------------------------------------
create table if not exists public.lite_categories (
  id          bigint primary key generated always as identity,
  user_id     uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  name        text not null,
  kind        text not null
    check (kind in ('expense', 'received')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.lite_categories enable row level security;
alter table public.lite_categories force row level security;

-- ---------------------------------------------------------------------------
-- lite_payees
-- ---------------------------------------------------------------------------
create table if not exists public.lite_payees (
  id          bigint primary key generated always as identity,
  user_id     uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.lite_payees enable row level security;
alter table public.lite_payees force row level security;

-- ---------------------------------------------------------------------------
-- lite_entries
-- ---------------------------------------------------------------------------
create table if not exists public.lite_entries (
  id            bigint primary key generated always as identity,
  user_id       uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  entry_date    date not null,
  kind          text not null
    check (kind in ('expense', 'received')),
  amount_minor  bigint not null check (amount_minor > 0),
  category_id   bigint references public.lite_categories(id) on delete set null,
  payee_id      bigint references public.lite_payees(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.lite_entries enable row level security;
alter table public.lite_entries force row level security;

-- updated_at trigger for lite_entries
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lite_entries_set_updated_at
  before update on public.lite_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

-- user_profiles
create policy "user_profiles_owner_all"
  on public.user_profiles
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_profiles_viewer_select"
  on public.user_profiles
  for select
  using (exists (
    select 1 from public.lite_shares s
    where s.owner_id = user_profiles.user_id
      and s.viewer_id = auth.uid()
  ));

-- lite_shares
create policy "lite_shares_owner_all"
  on public.lite_shares
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "lite_shares_viewer_select"
  on public.lite_shares
  for select
  using (viewer_id = auth.uid());

-- lite_categories
create policy "lite_categories_owner_all"
  on public.lite_categories
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "lite_categories_viewer_select"
  on public.lite_categories
  for select
  using (exists (
    select 1 from public.lite_shares s
    where s.owner_id = lite_categories.user_id
      and s.viewer_id = auth.uid()
  ));

-- lite_payees
create policy "lite_payees_owner_all"
  on public.lite_payees
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "lite_payees_viewer_select"
  on public.lite_payees
  for select
  using (exists (
    select 1 from public.lite_shares s
    where s.owner_id = lite_payees.user_id
      and s.viewer_id = auth.uid()
  ));

-- lite_entries
create policy "lite_entries_owner_all"
  on public.lite_entries
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "lite_entries_viewer_select"
  on public.lite_entries
  for select
  using (exists (
    select 1 from public.lite_shares s
    where s.owner_id = lite_entries.user_id
      and s.viewer_id = auth.uid()
  ));
