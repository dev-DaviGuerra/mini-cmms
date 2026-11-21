-- =====================================================================
-- Mini-CMMS — 01_schema.sql
-- Tabelas da seção 5 do projeto. Script reexecutável (derruba e recria).
-- =====================================================================

DROP TABLE IF EXISTS os_auditoria, alertas_estoque, movimentacoes, os_pecas,
                     ordens_servico, pecas, equipamentos, usuarios CASCADE;

-- ---------------------------------------------------------------------
-- usuarios: quem acessa o sistema. O perfil vai dentro do JWT.
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(100) NOT NULL,
    email       VARCHAR(150) NOT NULL UNIQUE,
    senha_hash  VARCHAR(100) NOT NULL,              -- hash bcrypt, nunca a senha
    perfil      VARCHAR(20)  NOT NULL
                CHECK (perfil IN ('OPERADOR', 'TECNICO', 'SUPERVISOR'))
);

-- ---------------------------------------------------------------------
-- equipamentos: ativos da fábrica fictícia.
-- ---------------------------------------------------------------------
CREATE TABLE equipamentos (
    id           SERIAL PRIMARY KEY,
    tag          VARCHAR(20)  NOT NULL UNIQUE,      -- ex.: R-03
    nome         VARCHAR(100) NOT NULL,
    linha        VARCHAR(50)  NOT NULL,             -- linha de produção
    criticidade  CHAR(1)      NOT NULL CHECK (criticidade IN ('A', 'B', 'C')),
    status       VARCHAR(10)  NOT NULL DEFAULT 'OPERANDO'
                 CHECK (status IN ('OPERANDO', 'PARADO'))
);

-- ---------------------------------------------------------------------
-- pecas: itens de estoque. O CHECK impede estoque negativo no nível do banco.
-- ---------------------------------------------------------------------
CREATE TABLE pecas (
    id           SERIAL PRIMARY KEY,
    codigo       VARCHAR(20)   NOT NULL UNIQUE,
    descricao    VARCHAR(150)  NOT NULL,
    estoque      INTEGER       NOT NULL DEFAULT 0 CHECK (estoque >= 0),
    estoque_min  INTEGER       NOT NULL DEFAULT 0 CHECK (estoque_min >= 0),
    custo_unit   NUMERIC(10,2) NOT NULL CHECK (custo_unit >= 0)
);

-- ---------------------------------------------------------------------
-- ordens_servico: ciclo ABERTA -> EM_ANDAMENTO -> FECHADA
--                 (ou AGUARDANDO_PECA / CANCELADA)
-- ---------------------------------------------------------------------
CREATE TABLE ordens_servico (
    id              SERIAL PRIMARY KEY,
    equipamento_id  INTEGER     NOT NULL REFERENCES equipamentos(id),
    aberta_por      INTEGER     NOT NULL REFERENCES usuarios(id),
    tecnico_id      INTEGER              REFERENCES usuarios(id),
    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('CORRETIVA', 'PREVENTIVA')),
    prioridade      VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                    CHECK (prioridade IN ('BAIXA', 'MEDIA', 'ALTA', 'EMERGENCIA')),
    status          VARCHAR(16) NOT NULL DEFAULT 'ABERTA'
                    CHECK (status IN ('ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO_PECA',
                                      'FECHADA', 'CANCELADA')),
    descricao       TEXT        NOT NULL,
    causa           VARCHAR(100),
    solucao         TEXT,
    aberta_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    iniciada_em     TIMESTAMPTZ,
    fechada_em      TIMESTAMPTZ,
    horas           NUMERIC(6,2) CHECK (horas >= 0),   -- horas técnicas apontadas
    -- coerência das datas
    CHECK (iniciada_em IS NULL OR iniciada_em >= aberta_em),
    CHECK (fechada_em  IS NULL OR fechada_em  >= aberta_em),
    -- OS fechada precisa ter data de fechamento
    CHECK (status <> 'FECHADA' OR fechada_em IS NOT NULL)
);

CREATE INDEX idx_os_equipamento ON ordens_servico (equipamento_id);
CREATE INDEX idx_os_status      ON ordens_servico (status);
CREATE INDEX idx_os_aberta_em   ON ordens_servico (aberta_em);

-- ---------------------------------------------------------------------
-- os_pecas: tabela associativa N:N entre OS e peças.
-- Guarda o custo unitário DO MOMENTO (o preço da peça pode mudar depois).
-- ---------------------------------------------------------------------
CREATE TABLE os_pecas (
    os_id       INTEGER       NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    peca_id     INTEGER       NOT NULL REFERENCES pecas(id),
    qtd         INTEGER       NOT NULL CHECK (qtd > 0),
    custo_unit  NUMERIC(10,2) NOT NULL CHECK (custo_unit >= 0),
    PRIMARY KEY (os_id, peca_id)
);

-- ---------------------------------------------------------------------
-- movimentacoes: rastreabilidade de toda entrada/saída de estoque.
-- ---------------------------------------------------------------------
CREATE TABLE movimentacoes (
    id          SERIAL PRIMARY KEY,
    peca_id     INTEGER     NOT NULL REFERENCES pecas(id),
    tipo        VARCHAR(7)  NOT NULL CHECK (tipo IN ('ENTRADA', 'SAIDA')),
    qtd         INTEGER     NOT NULL CHECK (qtd > 0),
    os_id       INTEGER              REFERENCES ordens_servico(id),
    usuario_id  INTEGER     NOT NULL REFERENCES usuarios(id),
    data        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- toda SAIDA precisa estar vinculada a uma OS
    CHECK (tipo = 'ENTRADA' OR os_id IS NOT NULL)
);

CREATE INDEX idx_mov_peca_data ON movimentacoes (peca_id, data);

-- ---------------------------------------------------------------------
-- alertas_estoque: preenchida pela trigger trg_estoque_minimo.
-- ---------------------------------------------------------------------
CREATE TABLE alertas_estoque (
    id         SERIAL PRIMARY KEY,
    peca_id    INTEGER     NOT NULL REFERENCES pecas(id),
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolvido  BOOLEAN     NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- os_auditoria: preenchida pela trigger trg_auditoria_os.
-- ---------------------------------------------------------------------
CREATE TABLE os_auditoria (
    id           SERIAL PRIMARY KEY,
    os_id        INTEGER     NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    status_de    VARCHAR(16) NOT NULL,
    status_para  VARCHAR(16) NOT NULL,
    usuario_id   INTEGER              REFERENCES usuarios(id),
    data         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auditoria_os ON os_auditoria (os_id);
