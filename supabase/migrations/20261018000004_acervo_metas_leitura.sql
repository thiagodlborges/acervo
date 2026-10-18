-- Meta de leitura da semana: por livro, página atual, páginas por dia e dias marcados.
alter table acervo.livros add column total_paginas int check (total_paginas > 0);
create table acervo.metas_leitura (
  id uuid primary key default gen_random_uuid(),
  livro_id uuid not null references acervo.livros(id) on delete cascade,
  semana date not null,
  pagina_inicial int not null check (pagina_inicial >= 0),
  pagina_atual int not null check (pagina_atual >= 0),
  paginas_por_dia int not null check (paginas_por_dia > 0),
  created_at timestamptz not null default now(),
  unique (livro_id, semana)
);
create table acervo.metas_leitura_dias (
  meta_id uuid not null references acervo.metas_leitura(id) on delete cascade,
  dia date not null,
  primary key (meta_id, dia)
);
