-- =====================================================================
-- Mini-CMMS — 04_consultas_bd2.sql
-- Três consultas complexas para a disciplina de BD2.
--
-- Parâmetros das três consultas (os mesmos de sp_kpis_equipamento):
--   $1 = data inicial, $2 = data final (DATE). O período é inclusivo: de $1 00:00 até
--   $2 23:59:59.
--
-- Rodar depois do seed. Sem -v, o período é o padrão: últimos 90 dias até hoje.
--   psql "$DATABASE_URL" -f database/04_consultas_bd2.sql
--   psql "$DATABASE_URL" -v data_ini=2026-09-01 -v data_fim=2026-09-30 -f database/04_consultas_bd2.sql
-- No psql, os valores chegam aos $1/$2 pelo comando \bind (psql 16 ou mais novo; o
-- servidor pode ser 14+). O psql manda o SQL e os valores separados, como a API faz.
--
-- A API (backend/src/consultasBd2.js) lê ESTE arquivo e expõe cada consulta em
-- /api/kpis/<nome>?inicio=AAAA-MM-DD&fim=AAAA-MM-DD, passando as datas como $1 e $2.
-- A linha "-- @consulta <nome>" marca o início de cada consulta. A API ignora tudo o que
-- vem antes do primeiro marcador e as linhas de comando do psql (\echo, \bind etc.).
-- Ao editar, mantenha uma consulta por marcador.
-- =====================================================================

-- Período padrão (só no psql): o que não veio por -v é calculado pelo banco.
\if :{?data_fim}
\else
SELECT CURRENT_DATE::text AS data_fim \gset
\endif
\if :{?data_ini}
\else
SELECT (:'data_fim'::date - 90)::text AS data_ini \gset
\endif
\echo '== Período:' :data_ini 'a' :data_fim '=='


-- ---------------------------------------------------------------------
-- Consulta 1 — Equipamentos com MTTR acima da média (SUBQUERY)
-- Usa a função sp_kpis_equipamento no período e compara o MTTR de cada
-- equipamento com a média geral, calculada numa subquery escalar.
-- ---------------------------------------------------------------------
-- @consulta mttr-acima-media
\echo '== 1. Equipamentos com MTTR acima da média =='
\bind :'data_ini' :'data_fim'
SELECT k.tag,
       k.nome,
       k.n_falhas,
       k.mttr_h,
       (SELECT ROUND(AVG(k2.mttr_h), 2)
          FROM sp_kpis_equipamento($1::date, $2::date) k2) AS mttr_medio_h
  FROM sp_kpis_equipamento($1::date, $2::date) k
 WHERE k.mttr_h > (SELECT AVG(k2.mttr_h)
                     FROM sp_kpis_equipamento($1::date, $2::date) k2)
 ORDER BY k.mttr_h DESC;


-- ---------------------------------------------------------------------
-- Consulta 2 — Top 5 peças mais consumidas no período
--              (JOIN + AGREGAÇÃO + HAVING)
-- Soma as SAÍDAS de estoque por peça e mostra quanto isso custou
-- e quantas OS diferentes usaram a peça.
-- ---------------------------------------------------------------------
-- @consulta top-pecas
\echo '== 2. Top 5 peças mais consumidas =='
\bind :'data_ini' :'data_fim'
SELECT p.codigo,
       p.descricao,
       SUM(m.qtd)                    AS qtd_consumida,
       COUNT(DISTINCT m.os_id)       AS qtd_os,
       SUM(m.qtd * p.custo_unit)     AS custo_estimado,
       p.estoque                     AS estoque_atual,
       p.estoque_min
  FROM movimentacoes m
  JOIN pecas p ON p.id = m.peca_id
 WHERE m.tipo = 'SAIDA'
   AND m.data >= $1::date
   AND m.data <  $2::date + 1
 GROUP BY p.id, p.codigo, p.descricao, p.estoque, p.estoque_min
HAVING SUM(m.qtd) > 0
 ORDER BY qtd_consumida DESC, p.codigo
 LIMIT 5;


-- ---------------------------------------------------------------------
-- Consulta 3 — Pareto das causas de falha (CTE + FUNÇÃO DE JANELA)
-- Conta as OS corretivas fechadas abertas no período (mesmo critério de
-- falha de sp_kpis_equipamento), por causa, e calcula o % acumulado.
-- As causas com % acumulado até ~80% são as "poucas vitais" do Pareto.
-- ---------------------------------------------------------------------
-- @consulta pareto-causas
\echo '== 3. Pareto das causas de falha =='
\bind :'data_ini' :'data_fim'
WITH por_causa AS (
    SELECT os.causa, COUNT(*) AS qtd
      FROM ordens_servico os
     WHERE os.tipo = 'CORRETIVA'
       AND os.status = 'FECHADA'
       AND os.causa IS NOT NULL
       AND os.aberta_em >= $1::date
       AND os.aberta_em <  $2::date + 1
     GROUP BY os.causa
),
com_percentual AS (
    SELECT causa,
           qtd,
           ROUND(100.0 * qtd / SUM(qtd) OVER (), 2) AS pct,
           ROUND(100.0 * SUM(qtd) OVER (ORDER BY qtd DESC, causa
                                        ROWS UNBOUNDED PRECEDING)
                       / SUM(qtd) OVER (), 2)       AS pct_acumulado
      FROM por_causa
)
SELECT causa,
       qtd,
       pct,
       pct_acumulado,
       CASE WHEN pct_acumulado - pct < 80 THEN 'A (vital)' ELSE 'B (trivial)' END AS classe
  FROM com_percentual
 ORDER BY qtd DESC, causa;
