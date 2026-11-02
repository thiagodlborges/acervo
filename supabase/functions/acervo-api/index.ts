import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import postgres from 'npm:postgres@3.4.4';

// API do app Acervo (séries, filmes e livros). Mesmo modelo de acesso das finanças:
// o navegador envia o token de sessão (app_sessions) em x-app-token; a função valida
// e acessa o schema `acervo` por conexão direta (o schema não é exposto pela API REST).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-app-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });

const TIT = ['tipo','status','titulo','temporadas_assistidas','proxima_temporada','streaming','ano','ranking','nota','observacao','tem_nova_temporada','imagem_url'];
const LIV = ['titulo','autor','categoria','status','ano_leitura','comprado','nota','observacao','imagem_url','total_paginas'];
const pick = (o: Record<string, unknown>, cols: string[]) =>
  Object.fromEntries(cols.filter(c => c in o).map(c => [c, o[c] === '' ? null : o[c]]));
const int = (v: unknown, min = 0) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error('número inválido');
  return n;
};
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function tokenOk(token: string) {
  if (!token) return false;
  const r = await sql`select 1 from public.app_sessions where token = ${token} and expires_at > now() limit 1`;
  return r.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const json = (d: object, s = 200) =>
    new Response(JSON.stringify(d), { headers: { ...CORS, 'Content-Type': 'application/json' }, status: s });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  if (!(await tokenOk(req.headers.get('x-app-token') || ''))) return json({ ok: false, error: 'Unauthorized' }, 401);

  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }

  try {
    switch (b.action) {
      case 'load': {
        const [titulos, livros, ranking, estado, metas, dias] = await Promise.all([
          sql`select * from acervo.titulos order by ranking nulls last, titulo`,
          sql`select * from acervo.livros order by posicao_fila nulls last, titulo`,
          sql`select * from acervo.livros_ranking order by posicao`,
          sql`select proximo_tipo, faixa_idx from acervo.estado_leitura where id = 1`,
          sql`select id, livro_id, semana::text as semana, data_inicio::text as data_inicio, data_fim::text as data_fim, ate_fim_livro, pagina_inicial, pagina_atual, paginas_por_dia from acervo.metas_leitura order by data_inicio desc, created_at`,
          sql`select meta_id, dia::text as dia from acervo.metas_leitura_dias`,
        ]);
        return json({ ok: true, titulos, livros, ranking, estado: estado[0] ?? null, metas, dias });
      }
      case 'save_titulo': {
        const row = pick(b.row ?? {}, TIT);
        if (b.id) await sql`update acervo.titulos set ${sql(row, ...Object.keys(row))} where id = ${b.id}`;
        else await sql`insert into acervo.titulos ${sql(row, ...Object.keys(row))}`;
        return json({ ok: true });
      }
      case 'delete_titulo':
        await sql`delete from acervo.titulos where id = ${b.id}`;
        return json({ ok: true });
      case 'save_livro': {
        const row: Record<string, unknown> = pick(b.row ?? {}, LIV);
        if (b.id) {
          const [cur] = await sql`select status from acervo.livros where id = ${b.id}`;
          // Saindo da fila: libera a posição (o trigger renumera os demais).
          if (cur?.status === 'para_ler' && row.status && row.status !== 'para_ler') row.posicao_fila = null;
          await sql`update acervo.livros set ${sql(row, ...Object.keys(row))} where id = ${b.id}`;
        } else {
          if (row.status === 'para_ler') {
            const [m] = await sql`select coalesce(max(posicao_fila), 0) + 1 as p from acervo.livros`;
            row.posicao_fila = m.p;
          }
          await sql`insert into acervo.livros ${sql(row, ...Object.keys(row))}`;
        }
        return json({ ok: true });
      }
      case 'delete_livro':
        await sql`delete from acervo.livros where id = ${b.id}`;
        return json({ ok: true });
      case 'iniciar_leitura':
        await sql`select acervo.iniciar_leitura(${b.id}::uuid)`;
        return json({ ok: true });
      case 'concluir_leitura':
        await sql`update acervo.livros set status = 'lido', ano_leitura = ${Number(b.ano)} where id = ${b.id} and status = 'lendo'`;
        return json({ ok: true });
      case 'save_ranking': {
        // Substitui um ranking inteiro (top10_vida | top10_ano | melhor_ano). Títulos novos viram livros lidos.
        const tipo = String(b.tipo);
        if (!['top10_vida', 'top10_ano', 'melhor_ano'].includes(tipo)) return json({ ok: false, error: 'tipo inválido' }, 400);
        const ano: number | null = tipo === 'top10_vida' ? null : Number(b.ano);
        if (tipo !== 'top10_vida' && !Number.isInteger(ano)) return json({ ok: false, error: 'ano inválido' }, 400);
        const max = tipo === 'melhor_ano' ? 1 : 10;
        const titulos: string[] = (Array.isArray(b.titulos) ? b.titulos : []).slice(0, max).map((t: unknown) => String(t ?? '').trim());
        await sql.begin(async (tx) => {
          await tx`delete from acervo.livros_ranking where tipo = ${tipo} and ano is not distinct from ${ano}`;
          for (let i = 0; i < titulos.length; i++) {
            const t = titulos[i];
            if (!t) continue;
            const [l] = await tx`select id from acervo.livros where lower(titulo) = lower(${t})
              order by (status = 'lido') desc, (ano_leitura is not distinct from ${ano}) desc, ano_leitura nulls last limit 1`;
            const id = l?.id ?? (await tx`insert into acervo.livros (titulo, status, ano_leitura) values (${t}, 'lido', ${ano}) returning id`)[0].id;
            await tx`insert into acervo.livros_ranking (tipo, ano, posicao, livro_id) values (${tipo}, ${ano}, ${i + 1}, ${id})`;
          }
        });
        return json({ ok: true });
      }
      case 'save_meta': {
        // Cria/atualiza a meta de um livro. Período: data_inicio (qualquer dia) até o domingo da semana,
        // ou, com ate_fim_livro, até o dia em que o livro termina lendo paginas_por_dia por dia.
        const pi = int(b.pagina_inicial), ppd = int(b.paginas_por_dia, 1);
        const inicio = b.data_inicio ?? b.semana;
        if (!isDate(inicio)) throw new Error('data de início inválida');
        const ateFim = b.ate_fim_livro === true;
        await sql.begin(async (tx) => {
          if (b.total_paginas != null && b.total_paginas !== '')
            await tx`update acervo.livros set total_paginas = ${int(b.total_paginas, 1)} where id = ${b.livro_id}`;
          let dias = 0;
          if (ateFim) {
            const [l] = await tx`select total_paginas from acervo.livros where id = ${b.livro_id}`;
            if (!l?.total_paginas) throw new Error('informe o total de páginas do livro');
            if (pi >= l.total_paginas) throw new Error('a página atual já é o fim do livro');
            dias = Math.ceil((l.total_paginas - pi) / ppd);
          }
          // semana = segunda-feira da semana de início; fim = domingo dessa semana ou último dia de leitura.
          const [p] = await tx`select (${inicio}::date - ((extract(isodow from ${inicio}::date)::int) - 1))::date::text as seg,
            (case when ${ateFim} then ${inicio}::date + (${dias}::int - 1)
                  else ${inicio}::date - ((extract(isodow from ${inicio}::date)::int) - 1) + 6 end)::date::text as fim`;
          if (b.id) {
            await tx`update acervo.metas_leitura set pagina_inicial = ${pi}, paginas_por_dia = ${ppd},
              semana = ${p.seg}::date, data_inicio = ${inicio}::date, data_fim = ${p.fim}::date, ate_fim_livro = ${ateFim} where id = ${b.id}`;
          } else {
            await tx`insert into acervo.metas_leitura (livro_id, semana, data_inicio, data_fim, ate_fim_livro, pagina_inicial, pagina_atual, paginas_por_dia)
              values (${b.livro_id}, ${p.seg}::date, ${inicio}::date, ${p.fim}::date, ${ateFim}, ${pi}, ${pi}, ${ppd})
              on conflict (livro_id, semana) do update set data_inicio = excluded.data_inicio, data_fim = excluded.data_fim,
                ate_fim_livro = excluded.ate_fim_livro, pagina_inicial = excluded.pagina_inicial,
                pagina_atual = excluded.pagina_atual, paginas_por_dia = excluded.paginas_por_dia`;
          }
        });
        return json({ ok: true });
      }
      case 'delete_meta':
        await sql`delete from acervo.metas_leitura where id = ${b.id}`;
        return json({ ok: true });
      case 'set_pagina':
        await sql`update acervo.metas_leitura set pagina_atual = ${int(b.pagina)} where id = ${b.id}`;
        return json({ ok: true });
      case 'toggle_dia': {
        // Marcar um dia soma as páginas da meta à página atual; desmarcar desfaz.
        if (!isDate(b.dia)) throw new Error('dia inválido');
        await sql.begin(async (tx) => {
          if (b.feito) {
            const r = await tx`insert into acervo.metas_leitura_dias (meta_id, dia) values (${b.meta_id}, ${b.dia}::date) on conflict do nothing returning 1 as x`;
            if (r.length) await tx`update acervo.metas_leitura set pagina_atual = pagina_atual + paginas_por_dia where id = ${b.meta_id}`;
          } else {
            const r = await tx`delete from acervo.metas_leitura_dias where meta_id = ${b.meta_id} and dia = ${b.dia}::date returning 1 as x`;
            if (r.length) await tx`update acervo.metas_leitura set pagina_atual = greatest(0, pagina_atual - paginas_por_dia) where id = ${b.meta_id}`;
          }
        });
        return json({ ok: true });
      }
      default:
        return json({ ok: false, error: 'ação desconhecida' }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
});
