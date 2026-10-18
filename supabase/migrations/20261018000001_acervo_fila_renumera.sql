-- Ao sair da fila (escolhido, concluído, movido ou excluído), os demais sobem de número.
create or replace function acervo.fila_fecha_buraco() returns trigger
language plpgsql set search_path = '' as $$
begin
  update acervo.livros set posicao_fila = posicao_fila - 1
  where user_id is not distinct from old.user_id and posicao_fila > old.posicao_fila;
  return null;
end $$;

create trigger t_livros_fila_saiu after update of posicao_fila on acervo.livros
  for each row when (old.posicao_fila is not null and new.posicao_fila is null)
  execute function acervo.fila_fecha_buraco();
create trigger t_livros_fila_excluido after delete on acervo.livros
  for each row when (old.posicao_fila is not null)
  execute function acervo.fila_fecha_buraco();

-- iniciar_leitura deixou de renumerar manualmente (o trigger faz isso); ver definição aplicada no projeto.
