-- Acervo pessoal: séries, filmes e livros.
-- Schema próprio (`acervo`), isolado das finanças (public.financas_state etc.).
create schema if not exists acervo;

create table acervo.config (
  id boolean primary key default true check (id),
  email_dono text not null
);
alter table acervo.config enable row level security; -- sem policies: só acessível via funções security definer
insert into acervo.config (email_dono) values ('thiagodlborges@gmail.com');

create table acervo.titulos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  tipo text not null check (tipo in ('serie','miniserie','filme')),
  status text not null check (status in ('assistindo','encerrada','assistido','para_assistir')),
  titulo text not null,
  temporadas_assistidas int,
  proxima_temporada text,   -- '2027', '2026-09' ou '2026-11-11'
  streaming text,
  ano int,
  ranking int,
  nota numeric(3,1) check (nota between 0 and 10),
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table acervo.livros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  titulo text not null,
  autor text,
  categoria text,
  status text not null check (status in ('para_ler','lendo','lido')),
  posicao_fila int,         -- posição na fila "para ler" (1 = próximo em ordem)
  ano_leitura int,
  comprado boolean not null default false,
  nota numeric(3,1) check (nota between 0 and 10),
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint livros_fila_unica unique (user_id, posicao_fila) deferrable initially deferred
);

create table acervo.livros_ranking (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  tipo text not null check (tipo in ('top10_vida','top10_ano','melhor_ano')),
  ano int,
  posicao int not null,
  livro_id uuid not null references acervo.livros(id) on delete cascade
);

-- Estado da regra de escolha: alterna "fora de ordem" (faixa 2–100, 101–200, …) e "em ordem" (nº 1).
create table acervo.leitura_estado (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  proximo_tipo text not null default 'fora' check (proximo_tipo in ('fora','ordem')),
  faixa_idx int not null default 0
);

create index on acervo.titulos (user_id, tipo, status);
create index on acervo.livros (user_id, status);

-- RLS: cada usuário só vê os próprios dados
do $$
declare t text;
begin
  foreach t in array array['titulos','livros','livros_ranking','leitura_estado'] loop
    execute format('alter table acervo.%I enable row level security', t);
    execute format('create policy "dono" on acervo.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

create or replace function acervo.set_updated_at() returns trigger language plpgsql
set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
create trigger t_titulos_upd before update on acervo.titulos for each row execute function acervo.set_updated_at();
create trigger t_livros_upd before update on acervo.livros for each row execute function acervo.set_updated_at();

-- Primeiro login do dono: assume os dados importados da planilha (user_id nulo).
create or replace function acervo.reivindicar_dados() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (auth.jwt() ->> 'email') is distinct from (select email_dono from acervo.config) then
    raise exception 'não autorizado';
  end if;
  update acervo.titulos set user_id = auth.uid() where user_id is null;
  update acervo.livros set user_id = auth.uid() where user_id is null;
  update acervo.livros_ranking set user_id = auth.uid() where user_id is null;
  update acervo.leitura_estado set user_id = auth.uid() where user_id is null;
end $$;

-- Regra: faixa vigente (para o sorteio "fora de ordem") e avanço do ciclo.
-- faixa_idx 0 => posições 2–100; 1 => 101–200; 2 => 201–300 …
create or replace function acervo.faixa(p_idx int) returns int[]
language sql immutable set search_path = '' as $$
  select case when p_idx = 0 then array[2,100] else array[p_idx*100+1,(p_idx+1)*100] end
$$;

-- Inicia a leitura de um livro da fila: valida a regra, remove da fila, renumera os demais e avança o ciclo.
create or replace function acervo.iniciar_leitura(p_livro uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_pos int; v_est acervo.leitura_estado; v_faixa int[]; v_max int;
begin
  select posicao_fila into v_pos from acervo.livros where id = p_livro and status = 'para_ler';
  if v_pos is null then raise exception 'livro não está na fila'; end if;
  select * into v_est from acervo.leitura_estado where user_id = (select auth.uid());
  if not found then
    insert into acervo.leitura_estado default values returning * into v_est;
  end if;
  if v_est.proximo_tipo = 'ordem' then
    if v_pos <> 1 then raise exception 'a vez é do primeiro da fila'; end if;
  else
    v_faixa := acervo.faixa(v_est.faixa_idx);
    select max(posicao_fila) into v_max from acervo.livros where status = 'para_ler';
    -- se a fila é menor que a faixa, aceita qualquer posição >= 2
    if v_pos < v_faixa[1] or (v_pos > v_faixa[2] and v_max >= v_faixa[1]) then
      raise exception 'escolha um livro entre as posições % e %', v_faixa[1], v_faixa[2];
    end if;
  end if;
  update acervo.livros set status = 'lendo', posicao_fila = null where id = p_livro;
  update acervo.livros set posicao_fila = posicao_fila - 1 where status = 'para_ler' and posicao_fila > v_pos;
  update acervo.leitura_estado set
    faixa_idx = case when v_est.proximo_tipo = 'ordem' then v_est.faixa_idx + 1 else v_est.faixa_idx end,
    proximo_tipo = case when v_est.proximo_tipo = 'ordem' then 'fora' else 'ordem' end
  where user_id = (select auth.uid());
end $$;

revoke all on function acervo.reivindicar_dados(), acervo.iniciar_leitura(uuid) from public, anon;
grant usage on schema acervo to authenticated;
grant all on all tables in schema acervo to authenticated;
grant execute on function acervo.reivindicar_dados(), acervo.iniciar_leitura(uuid), acervo.faixa(int) to authenticated;
revoke all on acervo.config from authenticated;
