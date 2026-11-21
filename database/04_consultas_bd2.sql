-- =====================================================================
-- Mini-CMMS — 04_consultas_bd2.sql
-- Três consultas complexas para a disciplina de BD2.
-- Rodar depois do seed:  psql "$DATABASE_URL" -f database/04_consultas_bd2.sql
--
-- A API (backend/src/consultasBd2.js) lê ESTE arquivo e expõe cada consulta em
-- /api/kpis/<nome>. A linha "-- @consulta <nome>" marca o início de cada uma; as linhas
-- "\echo" são só do psql e a API as ignora. Ao editar, mantenha uma consulta por marcador.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Consulta 1 — Equipamentos com MTTR acima da média (SUBQUERY)
-- Usa a função sp_kpis_equipamento nos últimos 90 dias e compara o MTTR de
-- cada equipamento com a média geral, calculada numa subquery escalar.
-- ---------------------------------------------------------------------
-- @consulta mttr-acima-media
\echo '== 1. Equipamentos com MTTR acima da média (últimos 90 dias) =='
SELECT k.tag,
       k.nome,
       k.n_falhas,
       k.mttr_h,
       (SELECT ROUND(AVG(k2.mttr_h), 2)
          FROM sp_kpis_equipamento(CURRENT_DATE - 90, CURRENT_DATE) k2) AS mttr_medio_h
  FROM sp_kpis_equipamento(CURRENT_DATE - 90, CURRENT_DATE) k
 WHERE k.mttr_h > (SELECT AVG(k2.mttr_h)
                     FROM sp_kpis_equipamento(CURRENT_DATE - 90, CURRENT_DATE) k2)
 ORDER BY k.mttr_h DESC;


-- ---------------------------------------------------------------------
-- Consulta 2 — Top 5 peças mais consumidas nos últimos 30 dias
--              (JOIN + AGREGAÇÃO + HAVING)
-- Soma as SAÍDAS de estoque por peça e mostra quanto isso custou
-- e quantas OS diferentes usaram a peça.
-- ---------------------------------------------------------------------
-- @consulta top-pecas
\echo '== 2. Top 5 peças mais consumidas (últimos 30 dias) =='
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
   AND m.data >= now() - INTERVAL '30 days'
 GROUP BY p.id, p.codigo, p.descricao, p.estoque, p.estoque_min
HAVING SUM(m.qtd) > 0
 ORDER BY qtd_consumida DESC, p.codigo
 LIMIT 5;


-- ---------------------------------------------------------------------
-- Consulta 3 — Pareto das causas de falha (CTE + FUNÇÃO DE JANELA)
-- Conta as OS corretivas fechadas por causa e calcula o % acumulado.
-- As causas com % acumulado até ~80% são as "poucas vitais" do Pareto.
-- ---------------------------------------------------------------------
-- @consulta pareto-causas
\echo '== 3. Pareto das causas de falha =='
WITH por_causa AS (
    SELECT os.causa, COUNT(*) AS qtd
      FROM ordens_servico os
     WHERE os.tipo = 'CORRETIVA'
       AND os.status = 'FECHADA'
       AND os.causa IS NOT NULL
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
