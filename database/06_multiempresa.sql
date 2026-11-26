-- =====================================================================
-- MaintOS — 06_multiempresa.sql  (issue #41: SaaS multiempresa)
--
-- Transforma a instalação de uma fábrica numa plataforma com várias empresas:
--   1. tabelas empresas, usuarios_plataforma e solicitacoes_acesso;
--   2. empresa_id NOT NULL nas 8 tabelas de negócio, com FKs compostas e índices.
--      Os dados que já existem vão para a "Empresa Demonstração";
--   3. Row-Level Security (ENABLE + FORCE) com políticas por current_setting('app.empresa_id');
--   4. papel maintos_app, usado pela API: sem BYPASSRLS e sem ser dono das tabelas;
--   5. funções SECURITY DEFINER para o que precisa ver além de uma empresa: login,
--      sessão, aprovação de solicitação e e-mail único na plataforma.
--
-- REEXECUTÁVEL: pode rodar quantas vezes quiser (IF NOT EXISTS, CREATE OR REPLACE e
-- blocos que conferem o catálogo antes de criar). Ordem: 01, 02, 03, 05, 06.
-- Rodar com o DONO das tabelas (DATABASE_URL_ADMIN), nunca com o maintos_app:
--   psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f database/06_multiempresa.sql
-- A senha do maintos_app NÃO fica aqui: o papel nasce sem login e a senha é definida à
-- parte (ALTER ROLE maintos_app LOGIN PASSWORD ...), fora do git.
--
-- Contexto de cada requisição (gravado pela API com set_config, como o app.usuario_id):
--   app.empresa_id  empresa do usuário logado  -> as políticas de RLS filtram por ele
--   app.usuario_id  usuário logado             -> auditoria das OS
--   app.plataforma  'on' só para o PLATAFORMA  -> solicitações e lista de empresas
-- Sem contexto, current_setting(..., true) devolve NULL ou '' e as políticas não deixam
-- ver nenhuma linha: esquecer o contexto não vaza dados, só devolve vazio.
-- =====================================================================

BEGIN;
-- sem os avisos "already exists, skipping" de cada reexecução
SET LOCAL client_min_messages = warning;

-- ---------------------------------------------------------------------
-- 1. Papel da API
-- ---------------------------------------------------------------------
-- Quem roda o script é o dono das funções SECURITY DEFINER abaixo (login, sessão,
-- aprovação), que precisam passar pela RLS. Com FORCE ROW LEVEL SECURITY, só um papel com
-- BYPASSRLS (o dono no Neon, cmms_owner) ou superusuário (postgres local e da CI) consegue.
DO $$
BEGIN
    IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'Rode o 06 com o dono das tabelas (BYPASSRLS ou superusuário), não com %', current_user;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maintos_app') THEN
        CREATE ROLE maintos_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

-- Ajudante só desta sessão (pg_temp): cria uma constraint se ela ainda não existir.
CREATE OR REPLACE FUNCTION pg_temp.criar_constraint(p_tabela regclass, p_nome text, p_ddl text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = p_tabela AND conname = p_nome) THEN
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', p_tabela, p_nome, p_ddl);
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Tabelas novas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empresas (
    id         SERIAL PRIMARY KEY,
    nome       VARCHAR(120) NOT NULL,
    cidade     VARCHAR(80),
    uf         CHAR(2),
    ativa      BOOLEAN      NOT NULL DEFAULT TRUE,
    criada_em  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Administradores da plataforma: FORA das empresas (por isso tabela própria, e
-- usuarios.empresa_id pode ser NOT NULL sem exceção).
CREATE TABLE IF NOT EXISTS usuarios_plataforma (
    id            SERIAL PRIMARY KEY,
    nome          VARCHAR(100) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    senha_hash    VARCHAR(100) NOT NULL,
    ativo         BOOLEAN      NOT NULL DEFAULT TRUE,
    trocar_senha  BOOLEAN      NOT NULL DEFAULT FALSE
);

-- Pedidos de acesso feitos na landing. Dados mínimos (LGPD): nada de CPF, telefone ou IP.
CREATE TABLE IF NOT EXISTS solicitacoes_acesso (
    id                  SERIAL PRIMARY KEY,
    empresa_nome        VARCHAR(120) NOT NULL,
    responsavel         VARCHAR(100) NOT NULL,
    email               VARCHAR(150) NOT NULL,
    cidade              VARCHAR(80)  NOT NULL,
    uf                  CHAR(2)      NOT NULL,
    equipamentos_aprox  INTEGER      NOT NULL CHECK (equipamentos_aprox BETWEEN 1 AND 100000),
    consentimento_em    TIMESTAMPTZ  NOT NULL,
    termo_versao        VARCHAR(20)  NOT NULL,
    status              VARCHAR(10)  NOT NULL DEFAULT 'PENDENTE'
                        CHECK (status IN ('PENDENTE', 'APROVADA', 'RECUSADA')),
    criada_em           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    decidida_em         TIMESTAMPTZ,
    decidida_por        INTEGER      REFERENCES usuarios_plataforma(id),
    motivo_recusa       VARCHAR(300),
    empresa_id          INTEGER      REFERENCES empresas(id),
    CHECK ((status = 'PENDENTE') = (decidida_em IS NULL)),
    CHECK (status <> 'APROVADA' OR empresa_id IS NOT NULL)
);
-- no máximo um pedido PENDENTE por e-mail (um segundo envio não duplica a fila)
CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitacao_pendente_email
    ON solicitacoes_acesso (lower(email)) WHERE status = 'PENDENTE';
CREATE INDEX IF NOT EXISTS idx_solicitacoes_status ON solicitacoes_acesso (status, criada_em DESC);

-- troca de senha obrigatória no primeiro login (senha temporária da aprovação)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trocar_senha BOOLEAN NOT NULL DEFAULT FALSE;

-- perfis das empresas continuam os três; o PLATAFORMA fica em usuarios_plataforma
-- ---------------------------------------------------------------------
-- 3. Empresa Demonstração: dona de tudo o que já existe
-- ---------------------------------------------------------------------
INSERT INTO empresas (nome, cidade, uf)
SELECT 'Empresa Demonstração', 'Rio de Janeiro', 'RJ'
 WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE nome = 'Empresa Demonstração');

-- ---------------------------------------------------------------------
-- 4. empresa_id nas 8 tabelas de negócio
--    DEFAULT = empresa do contexto: os INSERTs da API, das triggers e da procedure
--    não precisam mudar. Sem contexto, o DEFAULT é NULL e o NOT NULL recusa o INSERT.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_demo   INTEGER := (SELECT id FROM empresas WHERE nome = 'Empresa Demonstração' ORDER BY id LIMIT 1);
    v_tabela TEXT;
BEGIN
    FOREACH v_tabela IN ARRAY ARRAY['usuarios', 'equipamentos', 'pecas', 'ordens_servico',
                                    'os_pecas', 'movimentacoes', 'alertas_estoque', 'os_auditoria']
    LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS empresa_id INTEGER', v_tabela);
        EXECUTE format('UPDATE %I SET empresa_id = $1 WHERE empresa_id IS NULL', v_tabela) USING v_demo;
        EXECUTE format('ALTER TABLE %I ALTER COLUMN empresa_id SET NOT NULL', v_tabela);
        EXECUTE format($f$ALTER TABLE %I ALTER COLUMN empresa_id
                          SET DEFAULT NULLIF(current_setting('app.empresa_id', true), '')::INTEGER$f$, v_tabela);
        PERFORM pg_temp.criar_constraint(v_tabela::regclass, v_tabela || '_empresa_fk',
                                         'FOREIGN KEY (empresa_id) REFERENCES empresas(id)');
    END LOOP;
END $$;

-- Unicidade por empresa: a tag R-01 e o código ROL-6205 podem existir em duas empresas.
-- O e-mail continua único na plataforma inteira (o login é só por e-mail).
ALTER TABLE equipamentos DROP CONSTRAINT IF EXISTS equipamentos_tag_key;
ALTER TABLE pecas        DROP CONSTRAINT IF EXISTS pecas_codigo_key;
SELECT pg_temp.criar_constraint('equipamentos', 'equipamentos_empresa_tag_key',    'UNIQUE (empresa_id, tag)');
SELECT pg_temp.criar_constraint('pecas',        'pecas_empresa_codigo_key',        'UNIQUE (empresa_id, codigo)');

-- Alvos das FKs compostas: (empresa_id, id) único nas tabelas referenciadas
SELECT pg_temp.criar_constraint('usuarios',       'usuarios_empresa_id_id_key',       'UNIQUE (empresa_id, id)');
SELECT pg_temp.criar_constraint('equipamentos',   'equipamentos_empresa_id_id_key',   'UNIQUE (empresa_id, id)');
SELECT pg_temp.criar_constraint('pecas',          'pecas_empresa_id_id_key',          'UNIQUE (empresa_id, id)');
SELECT pg_temp.criar_constraint('ordens_servico', 'ordens_servico_empresa_id_id_key', 'UNIQUE (empresa_id, id)');

-- FKs compostas: uma linha só pode apontar para outra da MESMA empresa. Nem um bug na API
-- consegue ligar a OS da empresa A ao equipamento da empresa B. As FKs simples do 01 saem.
ALTER TABLE ordens_servico  DROP CONSTRAINT IF EXISTS ordens_servico_equipamento_id_fkey,
                            DROP CONSTRAINT IF EXISTS ordens_servico_aberta_por_fkey,
                            DROP CONSTRAINT IF EXISTS ordens_servico_tecnico_id_fkey;
ALTER TABLE os_pecas        DROP CONSTRAINT IF EXISTS os_pecas_os_id_fkey,
                            DROP CONSTRAINT IF EXISTS os_pecas_peca_id_fkey;
ALTER TABLE movimentacoes   DROP CONSTRAINT IF EXISTS movimentacoes_peca_id_fkey,
                            DROP CONSTRAINT IF EXISTS movimentacoes_os_id_fkey,
                            DROP CONSTRAINT IF EXISTS movimentacoes_usuario_id_fkey;
ALTER TABLE alertas_estoque DROP CONSTRAINT IF EXISTS alertas_estoque_peca_id_fkey;
ALTER TABLE os_auditoria    DROP CONSTRAINT IF EXISTS os_auditoria_os_id_fkey,
                            DROP CONSTRAINT IF EXISTS os_auditoria_usuario_id_fkey;

SELECT pg_temp.criar_constraint('ordens_servico',  'os_equipamento_fk',  'FOREIGN KEY (empresa_id, equipamento_id) REFERENCES equipamentos (empresa_id, id)');
SELECT pg_temp.criar_constraint('ordens_servico',  'os_aberta_por_fk',   'FOREIGN KEY (empresa_id, aberta_por) REFERENCES usuarios (empresa_id, id)');
SELECT pg_temp.criar_constraint('ordens_servico',  'os_tecnico_fk',      'FOREIGN KEY (empresa_id, tecnico_id) REFERENCES usuarios (empresa_id, id)');
SELECT pg_temp.criar_constraint('os_pecas',        'os_pecas_os_fk',     'FOREIGN KEY (empresa_id, os_id) REFERENCES ordens_servico (empresa_id, id) ON DELETE CASCADE');
SELECT pg_temp.criar_constraint('os_pecas',        'os_pecas_peca_fk',   'FOREIGN KEY (empresa_id, peca_id) REFERENCES pecas (empresa_id, id)');
SELECT pg_temp.criar_constraint('movimentacoes',   'mov_peca_fk',        'FOREIGN KEY (empresa_id, peca_id) REFERENCES pecas (empresa_id, id)');
SELECT pg_temp.criar_constraint('movimentacoes',   'mov_os_fk',          'FOREIGN KEY (empresa_id, os_id) REFERENCES ordens_servico (empresa_id, id)');
SELECT pg_temp.criar_constraint('movimentacoes',   'mov_usuario_fk',     'FOREIGN KEY (empresa_id, usuario_id) REFERENCES usuarios (empresa_id, id)');
SELECT pg_temp.criar_constraint('alertas_estoque', 'alertas_peca_fk',    'FOREIGN KEY (empresa_id, peca_id) REFERENCES pecas (empresa_id, id)');
SELECT pg_temp.criar_constraint('os_auditoria',    'auditoria_os_fk',    'FOREIGN KEY (empresa_id, os_id) REFERENCES ordens_servico (empresa_id, id) ON DELETE CASCADE');
SELECT pg_temp.criar_constraint('os_auditoria',    'auditoria_usuario_fk', 'FOREIGN KEY (empresa_id, usuario_id) REFERENCES usuarios (empresa_id, id)');

-- Índices com empresa_id na frente: toda consulta da API filtra pela empresa (via RLS).
DROP INDEX IF EXISTS idx_os_equipamento, idx_os_status, idx_os_aberta_em, idx_mov_peca_data, idx_auditoria_os;
CREATE INDEX IF NOT EXISTS idx_os_empresa_equipamento ON ordens_servico (empresa_id, equipamento_id);
CREATE INDEX IF NOT EXISTS idx_os_empresa_status      ON ordens_servico (empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_os_empresa_aberta_em   ON ordens_servico (empresa_id, aberta_em DESC);
CREATE INDEX IF NOT EXISTS idx_os_pecas_empresa_peca  ON os_pecas (empresa_id, peca_id);
CREATE INDEX IF NOT EXISTS idx_mov_empresa_peca_data  ON movimentacoes (empresa_id, peca_id, data);
CREATE INDEX IF NOT EXISTS idx_mov_empresa_data       ON movimentacoes (empresa_id, data);
CREATE INDEX IF NOT EXISTS idx_alertas_empresa_peca   ON alertas_estoque (empresa_id, peca_id) WHERE NOT resolvido;
CREATE INDEX IF NOT EXISTS idx_auditoria_empresa_os   ON os_auditoria (empresa_id, os_id);

-- ---------------------------------------------------------------------
-- 5. Triggers: a linha gerada herda a empresa da linha que a gerou
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_estoque_minimo() RETURNS trigger AS $$
BEGIN
    IF NEW.estoque < NEW.estoque_min AND OLD.estoque >= OLD.estoque_min THEN
        INSERT INTO alertas_estoque (empresa_id, peca_id) VALUES (NEW.empresa_id, NEW.id);
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_auditoria_os() RETURNS trigger AS $$
BEGIN
    INSERT INTO os_auditoria (empresa_id, os_id, status_de, status_para, usuario_id)
    VALUES (NEW.empresa_id, NEW.id, OLD.status, NEW.status,
            NULLIF(current_setting('app.usuario_id', true), '')::INTEGER);
    RETURN NEW;
END $$ LANGUAGE plpgsql;

-- E-mail único na plataforma: usuarios e usuarios_plataforma não podem repetir e-mail.
-- SECURITY DEFINER porque, pela RLS, a API não enxerga os usuários das outras empresas.
CREATE OR REPLACE FUNCTION fn_email_unico_plataforma() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF (TG_TABLE_NAME = 'usuarios'
            AND EXISTS (SELECT 1 FROM usuarios_plataforma WHERE lower(email) = lower(NEW.email)))
       OR (TG_TABLE_NAME = 'usuarios_plataforma'
            AND EXISTS (SELECT 1 FROM usuarios WHERE lower(email) = lower(NEW.email))) THEN
        RAISE EXCEPTION 'E-mail % já cadastrado na plataforma', NEW.email USING ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_email_unico ON usuarios;
CREATE TRIGGER trg_email_unico BEFORE INSERT OR UPDATE OF email ON usuarios
    FOR EACH ROW EXECUTE FUNCTION fn_email_unico_plataforma();
DROP TRIGGER IF EXISTS trg_email_unico ON usuarios_plataforma;
CREATE TRIGGER trg_email_unico BEFORE INSERT OR UPDATE OF email ON usuarios_plataforma
    FOR EACH ROW EXECUTE FUNCTION fn_email_unico_plataforma();

-- ---------------------------------------------------------------------
-- 6. Row-Level Security
--    FORCE: vale também para o dono das tabelas (só papéis com BYPASSRLS, como o dono
--    no Neon e o superusuário, passam por cima; a API nunca usa esses papéis).
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_tabela TEXT;
BEGIN
    FOREACH v_tabela IN ARRAY ARRAY['usuarios', 'equipamentos', 'pecas', 'ordens_servico',
                                    'os_pecas', 'movimentacoes', 'alertas_estoque', 'os_auditoria']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_tabela);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_tabela);
        EXECUTE format('DROP POLICY IF EXISTS isolamento_empresa ON %I', v_tabela);
        -- USING filtra o que se lê, altera e apaga; WITH CHECK barra gravar linha de outra empresa
        EXECUTE format($p$CREATE POLICY isolamento_empresa ON %I
                           USING      (empresa_id = NULLIF(current_setting('app.empresa_id', true), '')::INTEGER)
                           WITH CHECK (empresa_id = NULLIF(current_setting('app.empresa_id', true), '')::INTEGER)$p$,
                       v_tabela);
    END LOOP;
END $$;

-- empresas: cada empresa lê só a si mesma; o PLATAFORMA lê todas. Ninguém grava direto:
-- empresa nova só nasce pela fn_aprovar_solicitacao.
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leitura_empresa ON empresas;
CREATE POLICY leitura_empresa ON empresas FOR SELECT
    USING (id = NULLIF(current_setting('app.empresa_id', true), '')::INTEGER
           OR current_setting('app.plataforma', true) = 'on');

-- solicitações: qualquer um cria (só PENDENTE); só o PLATAFORMA lê e decide
ALTER TABLE solicitacoes_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitacoes_acesso FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS criar_publico ON solicitacoes_acesso;
CREATE POLICY criar_publico ON solicitacoes_acesso FOR INSERT
    WITH CHECK (status = 'PENDENTE' AND decidida_em IS NULL AND empresa_id IS NULL);
DROP POLICY IF EXISTS plataforma_le ON solicitacoes_acesso;
CREATE POLICY plataforma_le ON solicitacoes_acesso FOR SELECT
    USING (current_setting('app.plataforma', true) = 'on');
DROP POLICY IF EXISTS plataforma_decide ON solicitacoes_acesso;
CREATE POLICY plataforma_decide ON solicitacoes_acesso FOR UPDATE
    USING (current_setting('app.plataforma', true) = 'on')
    WITH CHECK (current_setting('app.plataforma', true) = 'on');

-- administradores da plataforma: cada um lê e altera só a própria linha (troca de senha)
ALTER TABLE usuarios_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios_plataforma FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proprio_admin ON usuarios_plataforma;
CREATE POLICY proprio_admin ON usuarios_plataforma
    USING (current_setting('app.plataforma', true) = 'on'
           AND id = NULLIF(current_setting('app.usuario_id', true), '')::INTEGER)
    WITH CHECK (current_setting('app.plataforma', true) = 'on'
           AND id = NULLIF(current_setting('app.usuario_id', true), '')::INTEGER);

-- ---------------------------------------------------------------------
-- 7. Funções SECURITY DEFINER (rodam com os direitos do dono, que passa pela RLS).
--    Cada uma faz UMA coisa e confere o que precisa; search_path fixo contra sequestro
--    de nomes. Só o maintos_app pode executá-las.
-- ---------------------------------------------------------------------

-- Login: ainda não se sabe a empresa, então procura o e-mail nas duas tabelas de usuários.
CREATE OR REPLACE FUNCTION fn_login(p_email TEXT)
RETURNS TABLE (id INTEGER, nome VARCHAR, email VARCHAR, senha_hash VARCHAR, perfil VARCHAR,
               ativo BOOLEAN, trocar_senha BOOLEAN, empresa_id INTEGER, empresa_nome VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT u.id, u.nome, u.email, u.senha_hash, u.perfil, u.ativo AND e.ativa, u.trocar_senha,
           u.empresa_id, e.nome
      FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
     WHERE u.email = lower(p_email)
    UNION ALL
    SELECT p.id, p.nome, p.email, p.senha_hash, 'PLATAFORMA', p.ativo, p.trocar_senha, NULL, NULL
      FROM usuarios_plataforma p
     WHERE p.email = lower(p_email)
$$;

-- Sessão: chamada pela API no início de TODA requisição autenticada, numa única viagem ao
-- banco. Confere o usuário do token (ativo, da empresa do token) e grava o contexto
-- (app.empresa_id, app.usuario_id, app.plataforma) com set_config na conexão. Se o usuário
-- não for válido, o contexto fica VAZIO (nenhuma linha visível) e a função não devolve nada.
CREATE OR REPLACE FUNCTION fn_sessao(p_usuario_id INTEGER, p_empresa_id INTEGER, p_plataforma BOOLEAN)
RETURNS TABLE (nome VARCHAR, perfil VARCHAR, trocar_senha BOOLEAN, empresa_id INTEGER, empresa_nome VARCHAR)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM set_config('app.empresa_id', '', false),
            set_config('app.usuario_id', '', false),
            set_config('app.plataforma', '', false);
    IF p_plataforma THEN
        RETURN QUERY
            SELECT p.nome, 'PLATAFORMA'::VARCHAR, p.trocar_senha, NULL::INTEGER, NULL::VARCHAR
              FROM usuarios_plataforma p
             WHERE p.id = p_usuario_id AND p.ativo;
        IF FOUND THEN
            PERFORM set_config('app.usuario_id', p_usuario_id::TEXT, false),
                    set_config('app.plataforma', 'on', false);
        END IF;
    ELSE
        RETURN QUERY
            SELECT u.nome, u.perfil, u.trocar_senha, u.empresa_id, e.nome
              FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
             WHERE u.id = p_usuario_id AND u.empresa_id = p_empresa_id AND u.ativo AND e.ativa;
        IF FOUND THEN
            PERFORM set_config('app.empresa_id', p_empresa_id::TEXT, false),
                    set_config('app.usuario_id', p_usuario_id::TEXT, false);
        END IF;
    END IF;
END $$;

-- Aprovação: cria a empresa e o primeiro SUPERVISOR (senha temporária já em hash, com
-- troca obrigatória) e marca a solicitação, tudo na mesma transação. Só o PLATAFORMA.
-- O PLATAFORMA nunca grava app.empresa_id: quem escreve na empresa nova é esta função.
CREATE OR REPLACE FUNCTION fn_aprovar_solicitacao(p_solicitacao_id INTEGER, p_senha_hash TEXT)
RETURNS TABLE (empresa_id INTEGER, empresa_nome VARCHAR, supervisor_id INTEGER,
               supervisor_nome VARCHAR, supervisor_email VARCHAR)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_admin INTEGER := NULLIF(current_setting('app.usuario_id', true), '')::INTEGER;
    v_sol   solicitacoes_acesso%ROWTYPE;
    v_emp   INTEGER;
    v_sup   INTEGER;
BEGIN
    IF current_setting('app.plataforma', true) IS DISTINCT FROM 'on' OR v_admin IS NULL THEN
        RAISE EXCEPTION 'Só o administrador da plataforma aprova solicitações' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_sol FROM solicitacoes_acesso s WHERE s.id = p_solicitacao_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitação % não encontrada', p_solicitacao_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_sol.status <> 'PENDENTE' THEN
        RAISE EXCEPTION 'Solicitação % já foi decidida (%)', p_solicitacao_id, v_sol.status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    INSERT INTO empresas (nome, cidade, uf) VALUES (v_sol.empresa_nome, v_sol.cidade, v_sol.uf)
    RETURNING id INTO v_emp;
    INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil, trocar_senha)
    VALUES (v_emp, v_sol.responsavel, lower(v_sol.email), p_senha_hash, 'SUPERVISOR', TRUE)
    RETURNING id INTO v_sup;
    UPDATE solicitacoes_acesso s
       SET status = 'APROVADA', decidida_em = now(), decidida_por = v_admin, empresa_id = v_emp
     WHERE s.id = p_solicitacao_id;

    RETURN QUERY SELECT v_emp, v_sol.empresa_nome, v_sup, v_sol.responsavel, lower(v_sol.email)::VARCHAR;
END $$;

-- Só o papel da API executa as funções que passam pela RLS
REVOKE ALL ON FUNCTION fn_login(TEXT), fn_sessao(INTEGER, INTEGER, BOOLEAN),
                       fn_aprovar_solicitacao(INTEGER, TEXT), fn_email_unico_plataforma() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_login(TEXT), fn_sessao(INTEGER, INTEGER, BOOLEAN),
                          fn_aprovar_solicitacao(INTEGER, TEXT) TO maintos_app;

-- ---------------------------------------------------------------------
-- 8. Permissões do maintos_app: o mínimo. Sem DELETE (usuário e OS nunca são apagados),
--    sem TRUNCATE, sem DDL e sem ser dono de nada.
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO maintos_app;
GRANT SELECT, INSERT, UPDATE ON usuarios, equipamentos, pecas, ordens_servico, os_pecas,
                                movimentacoes, alertas_estoque, os_auditoria TO maintos_app;
GRANT SELECT ON empresas TO maintos_app;
GRANT SELECT, INSERT, UPDATE ON solicitacoes_acesso TO maintos_app;
GRANT SELECT, UPDATE ON usuarios_plataforma TO maintos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO maintos_app;
GRANT EXECUTE ON FUNCTION sp_kpis_equipamento(DATE, DATE, NUMERIC) TO maintos_app;
GRANT EXECUTE ON PROCEDURE sp_entrada_estoque(INTEGER, INTEGER, INTEGER) TO maintos_app;

COMMIT;
