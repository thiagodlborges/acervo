-- Meta de leitura com período próprio: início em qualquer dia da semana e, opcionalmente, até o fim do livro.
alter table acervo.metas_leitura add column data_inicio date, add column data_fim date, add column ate_fim_livro boolean not null default false;
update acervo.metas_leitura set data_inicio = semana, data_fim = semana + 6;
alter table acervo.metas_leitura alter column data_inicio set not null, alter column data_fim set not null,
  add constraint metas_leitura_periodo check (data_fim >= data_inicio);
