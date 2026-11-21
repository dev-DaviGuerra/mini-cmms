-- =====================================================================
-- Mini-CMMS — 05_usuarios_ativo.sql
-- Gestão de usuários: coluna "ativo" em usuarios.
--
-- Usuário NUNCA é apagado: ordens_servico (aberta_por, tecnico_id), movimentacoes e
-- os_auditoria referenciam usuarios(id). Apagar quebraria essas chaves estrangeiras ou
-- (com CASCADE) apagaria o histórico. Quem sai da empresa é DESATIVADO: não entra mais
-- no sistema, mas o nome continua nas OS e na auditoria.
--
-- Script reexecutável (IF NOT EXISTS). Ordem de aplicação: 01, 02, 03, 05
-- (o 04 só contém consultas). Rodar de novo depois do 01, que recria a tabela.
-- =====================================================================

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN usuarios.ativo IS
    'FALSE = usuário desativado: não faz login e tokens já emitidos são recusados pela API';
