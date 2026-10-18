# Acervo

Controle pessoal de **séries, filmes e livros**, migrado da planilha `series-SPO-OBRAS-N02.xlsx`.

- **Banco:** Supabase, projeto *Cobrança Yeez* (mesmo das finanças pessoais), em schema próprio **`acervo`** — nenhuma tabela do `public` (finanças) é tocada.
- **App:** `index.html` único, estático (supabase-js via CDN). Login por e-mail/senha (Supabase Auth); RLS por usuário.

## Modelo (`schema acervo`)
| Tabela | Conteúdo |
|---|---|
| `titulos` | séries, minisséries e filmes (`tipo`, `status`, temporadas, próxima temporada, streaming, ano, ranking, nota) |
| `livros` | fila "para ler" (`posicao_fila`), lendo, lidos (`ano_leitura`), autor/categoria |
| `livros_ranking` | Top 10 da vida, Top 10 do ano, melhor leitura de cada ano |
| `leitura_estado` | estado da regra de escolha (próximo: fora de ordem ou em ordem; faixa vigente) |
| `config` | e-mail do dono (usado para assumir os dados importados no 1º login) |

## Regra de escolha do próximo livro
Alterna entre *fora de ordem* e *em ordem*: um livro entre as posições 2–100, depois o 1º da fila, depois um entre 101–200, depois o 1º da fila, e assim por diante.
`acervo.iniciar_leitura(livro)` valida a vez, marca como "lendo" e o trigger `fila_fecha_buraco` faz os demais subirem de número.

## Setup
1. Supabase → Settings → API → **Exposed schemas**: adicionar `acervo`.
2. Criar a conta no app com o e-mail do dono (`acervo.config`) e, depois, desabilitar novos cadastros em Auth → Providers → Email.
3. No 1º login o app chama `acervo.reivindicar_dados()` e os dados importados passam a ser seus.

`supabase/migrations/` tem o schema; `supabase/seed.sql` é a carga da planilha (já aplicada).
