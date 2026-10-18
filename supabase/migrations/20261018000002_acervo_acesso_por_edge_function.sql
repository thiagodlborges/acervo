-- Acesso igual ao das finanças: senha única + token (public.app_sessions) validado pela Edge Function `acervo-api`,
-- que acessa o schema `acervo` por conexão direta. O schema não é exposto pela API REST.
-- user_id / config / reivindicar_dados / leitura_estado ficam sem uso (legado do Supabase Auth).
create table acervo.estado_leitura (
  id int primary key default 1 check (id = 1),
  proximo_tipo text not null default 'fora' check (proximo_tipo in ('fora','ordem')),
  faixa_idx int not null default 0
);
alter table acervo.estado_leitura enable row level security;
insert into acervo.estado_leitura default values;
-- fila_fecha_buraco() e iniciar_leitura() foram reescritas sem user_id/auth.uid(); ver o banco.
revoke all on all tables in schema acervo from anon, authenticated;
revoke all on all functions in schema acervo from anon, authenticated, public;
revoke usage on schema acervo from anon, authenticated;
