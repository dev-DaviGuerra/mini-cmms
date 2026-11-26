// Isolamento entre empresas DIRETO NO SQL (#41), sem passar pela API: conecta como o papel
// da API (maintos_app) e prova que a Row-Level Security vale no próprio banco. Mesmo que
// alguém esqueça um WHERE no código, o banco não devolve nem grava linha de outra empresa.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { config } from '../src/config.js';
import { configConexao } from '../src/db.js';
import {
  pool, criarEmpresaDeTeste, criarUsuarios, criarEquipamento, criarPeca, encerrar, EMPRESA_ID,
} from './helpers.js';

const TABELAS_NEGOCIO = ['usuarios', 'equipamentos', 'pecas', 'ordens_servico', 'os_pecas',
  'movimentacoes', 'alertas_estoque', 'os_auditoria'];

let app;          // conexão como maintos_app
let empresaB;
const A = {};
const B = {};

const contexto = (empresaId) => app.query("SELECT set_config('app.empresa_id', $1, false)", [empresaId ? String(empresaId) : '']);
const contar = async (sql, params) => (await app.query(sql, params)).rows[0].n;
async function erroDe(sql, params) {
  try {
    await app.query(sql, params);
  } catch (erro) {
    return erro.code;
  }
  return null;
}

before(async () => {
  empresaB = await criarEmpresaDeTeste('B');
  A.usuarios = await criarUsuarios();
  B.usuarios = await criarUsuarios(empresaB, '-b');
  A.equipamento = await criarEquipamento();
  B.equipamento = await criarEquipamento(empresaB);
  B.peca = await criarPeca({ estoque: 5 }, empresaB);
  B.os = (await empresaB.pool.query(
    `INSERT INTO ordens_servico (equipamento_id, aberta_por, tipo, descricao)
     VALUES ($1, $2, 'CORRETIVA', 'OS da empresa B') RETURNING id`,
    [B.equipamento.id, B.usuarios.OPERADOR.id],
  )).rows[0].id;

  app = new pg.Client(configConexao(config.databaseUrl));
  await app.connect();
});

after(async () => {
  await app.end();
  await encerrar();
});

describe('papel e tabelas', () => {
  test('a API conecta com um papel que NÃO ignora a RLS (nem superusuário, nem BYPASSRLS)', async () => {
    const { rows } = await app.query(
      'SELECT current_user AS papel, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    assert.deepEqual(rows[0], { papel: 'maintos_app', rolsuper: false, rolbypassrls: false });
    const dono = await contar(
      "SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user");
    assert.equal(dono, 0, 'maintos_app não é dono de nenhuma tabela');
  });

  test('RLS ligada e FORCE em todas as tabelas de negócio e nas da plataforma', async () => {
    const { rows } = await app.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname = ANY($1::text[]) AND relkind = 'r' ORDER BY relname`,
      [[...TABELAS_NEGOCIO, 'empresas', 'solicitacoes_acesso', 'usuarios_plataforma']]);
    assert.equal(rows.length, 11);
    for (const r of rows) assert.ok(r.relrowsecurity && r.relforcerowsecurity, r.relname);
  });

  test('todas as tabelas de negócio têm empresa_id NOT NULL', async () => {
    const { rows } = await app.query(
      `SELECT table_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'empresa_id' AND table_name = ANY($1::text[])`,
      [TABELAS_NEGOCIO]);
    assert.equal(rows.length, TABELAS_NEGOCIO.length);
    for (const r of rows) assert.equal(r.is_nullable, 'NO', r.table_name);
  });
});

describe('leitura', () => {
  test('sem contexto: nenhuma linha de nenhuma empresa', async () => {
    await contexto(null);
    for (const tabela of TABELAS_NEGOCIO) {
      assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM ${tabela}`), 0, tabela);
    }
    assert.equal(await contar('SELECT COUNT(*)::int AS n FROM empresas'), 0);
  });

  test('com o contexto da A: só linhas da A, mesmo pedindo a B pelo id', async () => {
    await contexto(EMPRESA_ID);
    assert.equal(await contar('SELECT COUNT(*)::int AS n FROM equipamentos WHERE id = $1', [B.equipamento.id]), 0);
    assert.equal(await contar('SELECT COUNT(*)::int AS n FROM ordens_servico WHERE id = $1', [B.os]), 0);
    assert.equal(await contar('SELECT COUNT(*)::int AS n FROM usuarios WHERE id = $1', [B.usuarios.SUPERVISOR.id]), 0);
    assert.equal(await contar('SELECT COUNT(*)::int AS n FROM equipamentos WHERE id = $1', [A.equipamento.id]), 1);
    for (const tabela of TABELAS_NEGOCIO) {
      assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM ${tabela} WHERE empresa_id <> $1`, [EMPRESA_ID]), 0, tabela);
    }
    const empresas = (await app.query('SELECT id FROM empresas')).rows.map((r) => r.id);
    assert.deepEqual(empresas, [EMPRESA_ID], 'a empresa só enxerga a si mesma');
  });

  test('funções e consultas agregadas também respeitam a RLS', async () => {
    await contexto(EMPRESA_ID);
    const { rows } = await app.query("SELECT equipamento_id FROM sp_kpis_equipamento(CURRENT_DATE - 30, CURRENT_DATE)");
    assert.ok(rows.every((r) => r.equipamento_id !== B.equipamento.id));
  });
});

describe('escrita', () => {
  test('UPDATE em linha da B não afeta nada (0 linhas)', async () => {
    await contexto(EMPRESA_ID);
    const r1 = await app.query("UPDATE equipamentos SET status = 'PARADO' WHERE id = $1", [B.equipamento.id]);
    const r2 = await app.query("UPDATE ordens_servico SET status = 'FECHADA', fechada_em = now() WHERE id = $1", [B.os]);
    const r3 = await app.query('UPDATE pecas SET estoque = 0 WHERE id = $1', [B.peca.id]);
    const r4 = await app.query('UPDATE usuarios SET ativo = false WHERE id = $1', [B.usuarios.SUPERVISOR.id]);
    assert.deepEqual([r1.rowCount, r2.rowCount, r3.rowCount, r4.rowCount], [0, 0, 0, 0]);
    const b = (await empresaB.pool.query('SELECT estoque FROM pecas WHERE id = $1', [B.peca.id])).rows[0];
    assert.equal(b.estoque, 5);
  });

  test('INSERT com empresa_id da B é recusado pela política (42501)', async () => {
    await contexto(EMPRESA_ID);
    const codigo = await erroDe(
      "INSERT INTO equipamentos (empresa_id, tag, nome, linha, criticidade) VALUES ($1, 'INV-1', 'x', 'x', 'C')",
      [empresaB.id]);
    assert.equal(codigo, '42501');
  });

  test('mover uma linha da A para a B é recusado (WITH CHECK)', async () => {
    await contexto(EMPRESA_ID);
    assert.equal(await erroDe('UPDATE equipamentos SET empresa_id = $1 WHERE id = $2', [empresaB.id, A.equipamento.id]), '42501');
  });

  test('sem contexto, INSERT não grava: a política recusa antes até do NOT NULL (42501)', async () => {
    await contexto(null);
    const codigo = await erroDe("INSERT INTO equipamentos (tag, nome, linha, criticidade) VALUES ('SEM-1', 'x', 'x', 'C')");
    assert.equal(codigo, '42501');
  });

  test('o papel da API não pode apagar (sem DELETE) nem mexer em empresas', async () => {
    await contexto(EMPRESA_ID);
    assert.equal(await erroDe('DELETE FROM ordens_servico WHERE id = $1', [B.os]), '42501');
    assert.equal(await erroDe("UPDATE empresas SET nome = 'x' WHERE id = $1", [EMPRESA_ID]), '42501');
    assert.equal(await erroDe("INSERT INTO empresas (nome) VALUES ('invasora')"), '42501');
  });

  test('FK composta: nem o dono consegue ligar a OS da A ao equipamento da B (23503)', async () => {
    let codigo = null;
    try {
      await pool.query(
        "INSERT INTO ordens_servico (empresa_id, equipamento_id, aberta_por, tipo, descricao) VALUES ($1, $2, $3, 'CORRETIVA', 'cruzada')",
        [EMPRESA_ID, B.equipamento.id, A.usuarios.OPERADOR.id]);
    } catch (erro) {
      codigo = erro.code;
    }
    assert.equal(codigo, '23503');
  });
});

describe('plataforma', () => {
  test('uma empresa não lê as solicitações de acesso nem cria solicitação já aprovada', async () => {
    await contexto(EMPRESA_ID);
    assert.equal(await contar('SELECT COUNT(*)::int AS n FROM solicitacoes_acesso'), 0);
    const codigo = await erroDe(
      `INSERT INTO solicitacoes_acesso (empresa_nome, responsavel, email, cidade, uf, equipamentos_aprox,
                                        consentimento_em, termo_versao, status, decidida_em)
       VALUES ('x', 'x', 'x@x.com', 'x', 'SP', 1, now(), 'x', 'APROVADA', now())`);
    assert.equal(codigo, '42501');
  });

  test('aprovar solicitação fora do contexto do PLATAFORMA: recusado (42501)', async () => {
    await contexto(EMPRESA_ID);
    assert.equal(await erroDe("SELECT * FROM fn_aprovar_solicitacao(1, 'hash')"), '42501');
  });
});
