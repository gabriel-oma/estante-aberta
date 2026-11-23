create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id text not null,
  work_kind text not null check (work_kind in ('book', 'movie')),
  work_title text not null,
  rating integer not null check (rating between 1 and 5),
  review_text text,
  spoiler boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_kind, work_id)
);

alter table public.reviews enable row level security;
drop policy if exists "Reviews are readable by everyone" on public.reviews;
drop policy if exists "Users create their own reviews" on public.reviews;
drop policy if exists "Users update their own reviews" on public.reviews;
drop policy if exists "Users delete their own reviews" on public.reviews;
create policy "Reviews are readable by everyone" on public.reviews for select using (true);
create policy "Users create their own reviews" on public.reviews for insert with check (auth.uid() = user_id);
create policy "Users update their own reviews" on public.reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete their own reviews" on public.reviews for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at before update on public.reviews
for each row execute function public.set_updated_at();

create table if not exists public.shelf_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id text not null,
  work_kind text not null check (work_kind in ('book', 'movie')),
  work_title text not null,
  work_cover text,
  status text not null check (status in ('want_read', 'reading', 'read', 'want_watch', 'watching', 'watched')),
  created_at timestamptz not null default now(),
  unique (user_id, work_kind, work_id)
);
alter table public.shelf_items enable row level security;
drop policy if exists "Users manage their shelf" on public.shelf_items;
create policy "Users manage their shelf" on public.shelf_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 80),
  description text not null default '',
  is_public boolean not null default true,
  share_slug text not null unique default encode(gen_random_bytes(9), 'hex'),
  created_at timestamptz not null default now()
);
alter table public.collections enable row level security;
drop policy if exists "Public collections are readable" on public.collections;
drop policy if exists "Users create their collections" on public.collections;
drop policy if exists "Users update their collections" on public.collections;
drop policy if exists "Users delete their collections" on public.collections;
create policy "Public collections are readable" on public.collections for select using (is_public or auth.uid() = user_id);
create policy "Users create their collections" on public.collections for insert with check (auth.uid() = user_id);
create policy "Users update their collections" on public.collections for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete their collections" on public.collections for delete using (auth.uid() = user_id);

create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  work_id text not null,
  work_kind text not null check (work_kind in ('book', 'movie')),
  work_title text not null,
  work_cover text,
  created_at timestamptz not null default now(),
  unique (collection_id, work_kind, work_id)
);
alter table public.collection_items enable row level security;
drop policy if exists "Items in public collections are readable" on public.collection_items;
drop policy if exists "Collection owners manage items" on public.collection_items;
create policy "Items in public collections are readable" on public.collection_items for select using (
  exists (select 1 from public.collections c where c.id = collection_id and (c.is_public or c.user_id = auth.uid()))
);
create policy "Collection owners manage items" on public.collection_items for all using (
  exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
);

create index if not exists reviews_work_idx on public.reviews (work_kind, work_id);
create index if not exists collections_public_idx on public.collections (is_public, created_at desc);
create index if not exists collection_items_collection_idx on public.collection_items (collection_id, created_at);

create or replace view public.work_rating_summary as
select
  work_kind,
  work_id,
  avg(rating)::numeric(4, 2) as rating_average,
  count(*)::integer as vote_count
from public.reviews
group by work_kind, work_id;

grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;
grant select, insert, update, delete on public.shelf_items to authenticated;
grant select on public.collections to anon, authenticated;
grant insert, update, delete on public.collections to authenticated;
grant select on public.collection_items to anon, authenticated;
grant insert, update, delete on public.collection_items to authenticated;
grant select on public.work_rating_summary to anon, authenticated;
