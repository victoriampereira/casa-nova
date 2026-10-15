-- Casa Nova: banco de dados
-- Cole tudo isto no Supabase em SQL Editor > New query e clique em Run.

create table if not exists public.items (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  room        text not null,
  name        text not null,
  price       numeric,
  priority    text not null default 'essencial',
  note        text not null default '',
  link        text not null default '',
  done        boolean not null default false,
  options     jsonb not null default '[]'::jsonb,
  chosen_id   text,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table public.items enable row level security;

drop policy if exists "itens: dono le"     on public.items;
drop policy if exists "itens: dono cria"   on public.items;
drop policy if exists "itens: dono altera" on public.items;
drop policy if exists "itens: dono apaga"  on public.items;

create policy "itens: dono le"     on public.items for select using (auth.uid() = user_id);
create policy "itens: dono cria"   on public.items for insert with check (auth.uid() = user_id);
create policy "itens: dono altera" on public.items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "itens: dono apaga"  on public.items for delete using (auth.uid() = user_id);

-- Sincronizacao ao vivo entre celular e computador
do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null; end $$;

-- Fotos dos produtos
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do nothing;

drop policy if exists "fotos: dono envia" on storage.objects;
drop policy if exists "fotos: dono apaga" on storage.objects;

create policy "fotos: dono envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Orçamento editável (um registro por pessoa)
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  budget numeric not null default 15000,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "config: dono le" on public.settings;
drop policy if exists "config: dono cria" on public.settings;
drop policy if exists "config: dono altera" on public.settings;
create policy "config: dono le" on public.settings for select using (auth.uid() = user_id);
create policy "config: dono cria" on public.settings for insert with check (auth.uid() = user_id);
create policy "config: dono altera" on public.settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
do $$ begin
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;
