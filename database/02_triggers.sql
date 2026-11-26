-- =====================================================================
-- MaintOS — 02_triggers.sql
-- trg_estoque_minimo e trg_auditoria_os
-- =====================================================================

-- ---------------------------------------------------------------------
-- trg_estoque_minimo
-- Após UPDATE do estoque de uma peça: se o estoque CRUZOU para baixo do
-- mínimo (antes estava >= mínimo, agora está < mínimo), registra um alerta.
-- Comparar OLD e NEW evita gerar um alerta novo a cada baixa quando a
-- peça já estava abaixo do mínimo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_estoque_minimo() RETURNS trigger AS $$
BEGIN
    IF NEW.estoque < NEW.estoque_min AND OLD.estoque >= OLD.estoque_min THEN
        INSERT INTO alertas_estoque (peca_id) VALUES (NEW.id);
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_estoque_minimo ON pecas;
CREATE TRIGGER trg_estoque_minimo
    AFTER UPDATE OF estoque ON pecas
    FOR EACH ROW EXECUTE FUNCTION fn_estoque_minimo();

-- ---------------------------------------------------------------------
-- trg_auditoria_os
-- Após UPDATE do status de uma OS, grava status anterior, novo, usuário
-- e data em os_auditoria.
--
-- Como a trigger descobre o usuário? A API executa, dentro da transação,
--     SET LOCAL app.usuario_id = '<id do usuário do JWT>';
-- e a trigger lê com current_setting('app.usuario_id', true).
-- O segundo argumento "true" devolve NULL se a variável não existir
-- (ex.: UPDATE feito direto no psql), em vez de dar erro.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_auditoria_os() RETURNS trigger AS $$
BEGIN
    INSERT INTO os_auditoria (os_id, status_de, status_para, usuario_id)
    VALUES (NEW.id, OLD.status, NEW.status,
            NULLIF(current_setting('app.usuario_id', true), '')::INTEGER);
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_os ON ordens_servico;
CREATE TRIGGER trg_auditoria_os
    AFTER UPDATE OF status ON ordens_servico
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)   -- só quando o status muda de fato
    EXECUTE FUNCTION fn_auditoria_os();
