// Indicadores (H8): função sp_kpis_equipamento, resumo do dashboard e consultas BD2.
import { query } from '../db.js';
import { CONSULTAS_BD2 } from '../consultasBd2.js';

// O driver pg devolve NUMERIC como string (para não perder precisão). Os KPIs são valores
// pequenos com 2 casas, então convertemos para número para o front usar direto no gráfico.
function numerico(linhas, campos) {
  return linhas.map((l) => {
    const copia = { ...l };
    for (const c of campos) if (copia[c] !== null && copia[c] !== undefined) copia[c] = Number(copia[c]);
    return copia;
  });
}

// KPIs por equipamento no período. Sem datas: últimos 90 dias até hoje (data do banco).
export async function kpisPorEquipamento({ inicio, fim }) {
  // ::text devolve 'AAAA-MM-DD' (sem isso o pg converte DATE em Date do JS, com fuso horário)
  const periodo = await query(
    `SELECT COALESCE($2::date, CURRENT_DATE)::text                            AS fim,
            COALESCE($1::date, COALESCE($2::date, CURRENT_DATE) - 90)::text   AS inicio`,
    [inicio ?? null, fim ?? null],
  );
  const { inicio: ini, fim: fi } = periodo.rows[0];

  const { rows } = await query(
    `SELECT equipamento_id, tag, nome, linha, n_falhas, mttr_h, mtbf_h, disponibilidade, custo_total
       FROM sp_kpis_equipamento($1::date, $2::date)`,
    [ini, fi],
  );

  return {
    inicio: ini,
    fim: fi,
    equipamentos: numerico(rows, ['mttr_h', 'mtbf_h', 'disponibilidade', 'custo_total']),
  };
}

// Totais para os cards do dashboard, numa única consulta (COUNT ... FILTER).
export async function resumo() {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FILTER (WHERE status = 'ABERTA')          FROM ordens_servico)::int AS os_abertas,
      (SELECT COUNT(*) FILTER (WHERE status = 'EM_ANDAMENTO')    FROM ordens_servico)::int AS os_em_andamento,
      (SELECT COUNT(*) FILTER (WHERE status = 'AGUARDANDO_PECA') FROM ordens_servico)::int AS os_aguardando_peca,
      (SELECT COUNT(*) FROM equipamentos WHERE status = 'PARADO')::int                     AS equipamentos_parados,
      (SELECT COUNT(*) FROM alertas_estoque WHERE NOT resolvido)::int                      AS alertas_pendentes`);
  return rows[0];
}

// Consultas BD2: SQL lido de database/04_consultas_bd2.sql (mesmo texto do psql).
export async function mttrAcimaDaMedia() {
  const { rows } = await query(CONSULTAS_BD2['mttr-acima-media']);
  return numerico(rows, ['mttr_h', 'mttr_medio_h']);
}

export async function topPecas30Dias() {
  const { rows } = await query(CONSULTAS_BD2['top-pecas']);
  return numerico(rows, ['qtd_consumida', 'qtd_os', 'custo_estimado']);
}

export async function paretoCausas() {
  const { rows } = await query(CONSULTAS_BD2['pareto-causas']);
  return numerico(rows, ['qtd', 'pct', 'pct_acumulado']);
}
