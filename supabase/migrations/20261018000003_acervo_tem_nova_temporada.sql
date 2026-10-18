-- Marcação laranja da planilha: série em andamento com temporada nova disponível para assistir.
alter table acervo.titulos add column tem_nova_temporada boolean not null default false;
update acervo.titulos set tem_nova_temporada = true
where tipo = 'serie' and status = 'assistindo'
  and titulo in ('The Traitors','Matéria Escura','Terra da Máfia','Guerra Culinária','Os Piores Ex');
