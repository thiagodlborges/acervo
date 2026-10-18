# Acervo

Controle pessoal de **séries, filmes e livros**, migrado da planilha `series-SPO-OBRAS-N02.xlsx`.

- **Banco:** Supabase, projeto *Cobrança Yeez* (mesmo das finanças pessoais), em schema próprio **`acervo`**. Nenhuma tabela do `public` (finanças) é tocada, e o schema não é exposto pela API REST.
- **Acesso:** igual ao app de finanças. Senha única (`app-login`) gera um token (`app_sessions`, mesma chave `fc_token`); a Edge Function `acervo-api` valida o token e lê/grava no schema `acervo` por conexão direta.
- **App:** `index.html` único e estático.

## Modelo (`schema acervo`)
| Tabela | Conteúdo |
|---|---|
| `titulos` | séries, minisséries e filmes (`tipo`, `status`, temporadas, próxima temporada, streaming, ano, ranking, nota) |
| `livros` | fila "para ler" (`posicao_fila`), lendo, lidos (`ano_leitura`), autor/categoria |
| `livros_ranking` | Top 10 da vida, Top 10 do ano, melhor leitura de cada ano |
| `estado_leitura` | estado da regra de escolha (próximo: fora de ordem ou em ordem; faixa vigente) |

## Regra de escolha do próximo livro
Alterna entre *fora de ordem* e *em ordem*: um livro entre as posições 2–100, depois o 1º da fila, depois um entre 101–200, depois o 1º da fila, e assim por diante.
`acervo.iniciar_leitura(livro)` valida a vez e marca como "lendo". O trigger `fila_fecha_buraco` faz os demais subirem de número.

`supabase/migrations/` documenta o schema; `supabase/seed.sql` é a carga da planilha (já aplicada).
