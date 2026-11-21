-- =====================================================================
-- Mini-CMMS — 03_procedures.sql
-- sp_kpis_equipamento(data_ini, data_fim [, custo_hora])
--
-- Retorna uma linha por equipamento com:
--   n_falhas          nº de OS CORRETIVAS fechadas abertas no período
--   mttr_h            Σ tempo de reparo ÷ nº de falhas      (horas)
--   mtbf_h            tempo operando ÷ nº de falhas         (horas)
--   disponibilidade   MTBF ÷ (MTBF + MTTR) × 100            (%)
--   custo_total       Σ (qtd × custo_unit) + horas × custo_hora   (R$)
--
-- Decisões:
--   * Tempo de reparo = fechada_em − aberta_em (mede o tempo PARADO, do
--     ponto de vista da produção, não só o tempo de mão na massa).
--   * O período é inclusivo: de data_ini 00:00 até data_fim 23:59:59.
--   * Sem falhas no período: MTTR e MTBF ficam NULL, disponibilidade = 100.
--   * O custo considera todas as OS fechadas (corretivas e preventivas).
--
-- Em PostgreSQL, uma rotina que devolve uma tabela é escrita como
-- FUNCTION ... RETURNS TABLE (PROCEDURE não retorna conjunto de linhas).
-- Uso:  SELECT * FROM sp_kpis_equipamento('2026-08-23', '2026-11-21');
-- =====================================================================

DROP FUNCTION IF EXISTS sp_kpis_equipamento(DATE, DATE, NUMERIC);

CREATE OR REPLACE FUNCTION sp_kpis_equipamento(
    p_data_ini   DATE,
    p_data_fim   DATE,
    p_custo_hora NUMERIC DEFAULT 80.00
)
RETURNS TABLE (
    equipamento_id   INTEGER,
    tag              VARCHAR,
    nome             VARCHAR,
    linha            VARCHAR,
    n_falhas         INTEGER,
    mttr_h           NUMERIC,
    mtbf_h           NUMERIC,
    disponibilidade  NUMERIC,
    custo_total      NUMERIC
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_ini       TIMESTAMPTZ := p_data_ini::TIMESTAMPTZ;
    v_fim       TIMESTAMPTZ := (p_data_fim + 1)::TIMESTAMPTZ;
    v_periodo_h NUMERIC     := EXTRACT(EPOCH FROM (v_fim - v_ini)) / 3600;
BEGIN
    IF p_data_fim < p_data_ini THEN
        RAISE EXCEPTION 'data_fim (%) é anterior a data_ini (%)', p_data_fim, p_data_ini;
    END IF;

    RETURN QUERY
    WITH falhas AS (            -- reparo de cada OS corretiva fechada no período
        SELECT os.equipamento_id,
               EXTRACT(EPOCH FROM (os.fechada_em - os.aberta_em)) / 3600 AS reparo_h
          FROM ordens_servico os
         WHERE os.tipo   = 'CORRETIVA'
           AND os.status = 'FECHADA'
           AND os.aberta_em >= v_ini AND os.aberta_em < v_fim
    ),
    resumo_falhas AS (
        SELECT f.equipamento_id,
               COUNT(*)::INTEGER AS n,
               SUM(f.reparo_h)   AS reparo_total_h
          FROM falhas f
         GROUP BY f.equipamento_id
    ),
    custo_pecas AS (            -- custo de peças por OS
        SELECT op.os_id, SUM(op.qtd * op.custo_unit) AS valor
          FROM os_pecas op
         GROUP BY op.os_id
    ),
    custos AS (                 -- peças + mão de obra, por equipamento
        SELECT os.equipamento_id,
               SUM(COALESCE(cp.valor, 0) + COALESCE(os.horas, 0) * p_custo_hora) AS valor
          FROM ordens_servico os
          LEFT JOIN custo_pecas cp ON cp.os_id = os.id
         WHERE os.status = 'FECHADA'
           AND os.aberta_em >= v_ini AND os.aberta_em < v_fim
         GROUP BY os.equipamento_id
    ),
    base AS (
        SELECT e.id, e.tag, e.nome, e.linha,
               COALESCE(rf.n, 0) AS n,
               rf.reparo_total_h / NULLIF(rf.n, 0) AS mttr,
               GREATEST(v_periodo_h - COALESCE(rf.reparo_total_h, 0), 0)
                   / NULLIF(rf.n, 0) AS mtbf,
               COALESCE(c.valor, 0) AS custo
          FROM equipamentos e
          LEFT JOIN resumo_falhas rf ON rf.equipamento_id = e.id
          LEFT JOIN custos        c  ON c.equipamento_id  = e.id
    )
    SELECT b.id, b.tag, b.nome, b.linha, b.n,
           ROUND(b.mttr, 2),
           ROUND(b.mtbf, 2),
           CASE WHEN b.n = 0 THEN 100.00
                ELSE ROUND(b.mtbf / NULLIF(b.mtbf + b.mttr, 0) * 100, 2)
           END,
           ROUND(b.custo, 2)
      FROM base b
     ORDER BY b.tag;
END $$;


-- =====================================================================
-- sp_entrada_estoque(p_peca_id, p_qtd, p_usuario_id)
--
-- PROCEDURE de verdade (CREATE PROCEDURE, chamada com CALL): não devolve
-- linhas, só executa uma ação. Dá entrada de material no estoque:
--   1. soma p_qtd ao estoque da peça;
--   2. grava a movimentação ENTRADA (rastreabilidade);
--   3. se o estoque voltou a ficar >= estoque_min, marca os alertas
--      pendentes da peça como resolvidos.
--
-- Não faz COMMIT por conta própria: quem chama decide a transação. Assim a
-- API pode chamá-la dentro de um BEGIN ... COMMIT junto com outros passos,
-- e qualquer erro (peça inexistente, qtd inválida, usuário inválido) desfaz
-- tudo.
-- Uso:  CALL sp_entrada_estoque(1, 10, 4);
-- =====================================================================

DROP PROCEDURE IF EXISTS sp_entrada_estoque(INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE PROCEDURE sp_entrada_estoque(
    p_peca_id    INTEGER,
    p_qtd        INTEGER,
    p_usuario_id INTEGER
)
LANGUAGE plpgsql AS $$
DECLARE
    v_estoque     INTEGER;
    v_estoque_min INTEGER;
BEGIN
    IF p_qtd IS NULL OR p_qtd <= 0 THEN
        RAISE EXCEPTION 'Quantidade de entrada deve ser maior que zero (recebido: %)', p_qtd;
    END IF;

    UPDATE pecas
       SET estoque = estoque + p_qtd
     WHERE id = p_peca_id
    RETURNING estoque, estoque_min INTO v_estoque, v_estoque_min;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Peça % não encontrada', p_peca_id;
    END IF;

    -- usuario_id inválido é barrado pela FK de movimentacoes
    INSERT INTO movimentacoes (peca_id, tipo, qtd, usuario_id)
    VALUES (p_peca_id, 'ENTRADA', p_qtd, p_usuario_id);

    IF v_estoque >= v_estoque_min THEN
        UPDATE alertas_estoque
           SET resolvido = TRUE
         WHERE peca_id = p_peca_id
           AND NOT resolvido;
    END IF;
END $$;
