// Isolamento entre empresas PELA API (#41). Um usuário da empresa A não lista, não lê, não
// altera e não fecha OS, peças, equipamentos ou usuários da empresa B: para a A, os
// registros da B simplesmente não existem (404), como um id que nunca foi criado.
// Quem garante é a Row-Level Security do PostgreSQL: a API conecta como maintos_app.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import {
  pool, criarEmpresaDeTeste, criarUsuarios, criarEquipamento, criarPeca, encerrar, login, abrirOs, EMPRESA_ID,
} from './helpers.js';

let empresaB;
const A = { tokens: {} };
const B = { tokens: {} };

const comoA = (chave) => ({ Authorization: `Bearer ${A.tokens[chave]}` });
const comoB = (chave) => ({ Authorization: `Bearer ${B.tokens[chave]}` });
const linhaB = async (sql, params) => (await empresaB.pool.query(sql, params)).rows[0];

before(async () => {
  empresaB = await criarEmpresaDeTeste('B');
  A.usuarios = await criarUsuarios();
  B.usuarios = await criarUsuarios(empresaB, '-b');
  for (const chave of Object.keys(A.usuarios)) A.tokens[chave] = await login(app, request, A.usuarios[chave]);
  for (const chave of Object.keys(B.usuarios)) B.tokens[chave] = await login(app, request, B.usuarios[chave]);

  A.equipamento = await criarEquipamento();
  A.peca = await criarPeca({ estoque: 10 });
  B.equipamento = await criarEquipamento(empresaB);
  B.peca = await criarPeca({ estoque: 10, estoqueMin: 20 }, empresaB);

  // empresa B: uma OS aberta, uma em andamento e um alerta de estoque, criados pela própria B
  B.osAberta = await abrirOs(app, request, B.tokens.OPERADOR, B.equipamento.id);
  B.osAndamento = await abrirOs(app, request, B.tokens.OPERADOR, B.equipamento.id);
  const assumida = await request(app).post(`/api/os/${B.osAndamento.id}/assumir`).set(comoB('TECNICO'));
  assert.equal(assumida.status, 200);
  await empresaB.pool.query('INSERT INTO alertas_estoque (peca_id) VALUES ($1)', [B.peca.id]);
  // empresa A: uma OS em andamento, para tentar fechá-la com peça da B
  A.os = await abrirOs(app, request, A.tokens.OPERADOR, A.equipamento.id);
  await request(app).post(`/api/os/${A.os.id}/assumir`).set(comoA('TECNICO'));
});

after(encerrar);

describe('ordens de serviço da outra empresa', () => {
  test('não aparecem na lista, nem com filtro pelo equipamento da B', async () => {
    const lista = await request(app).get('/api/os?limit=200').set(comoA('SUPERVISOR'));
    assert.equal(lista.status, 200);
    const ids = lista.body.dados.map((o) => o.id);
    assert.ok(ids.includes(A.os.id));
    assert.ok(!ids.includes(B.osAberta.id) && !ids.includes(B.osAndamento.id));
    assert.equal(lista.body.paginacao.total, 1, 'o total também só conta a empresa A');

    const filtrada = await request(app).get(`/api/os?equipamentoId=${B.equipamento.id}`).set(comoA('SUPERVISOR'));
    assert.deepEqual(filtrada.body.dados, []);
  });

  test('ler o detalhe: 404', async () => {
    const res = await request(app).get(`/api/os/${B.osAberta.id}`).set(comoA('SUPERVISOR'));
    assert.equal(res.status, 404);
    assert.equal(res.body.erro.codigo, 'NAO_ENCONTRADO');
  });

  test('assumir: 404, e a OS da B continua ABERTA', async () => {
    const res = await request(app).post(`/api/os/${B.osAberta.id}/assumir`).set(comoA('TECNICO'));
    assert.equal(res.status, 404);
    const os = await linhaB('SELECT status, tecnico_id FROM ordens_servico WHERE id = $1', [B.osAberta.id]);
    assert.deepEqual(os, { status: 'ABERTA', tecnico_id: null });
  });

  test('fechar: 404, e a OS da B continua EM_ANDAMENTO, sem baixa de estoque', async () => {
    const res = await request(app).post(`/api/os/${B.osAndamento.id}/fechar`).set(comoA('SUPERVISOR'))
      .send({ causa: 'Invasão', solucao: 'Tentativa de outra empresa', horas: 1, pecas: [{ pecaId: A.peca.id, qtd: 1 }] });
    assert.equal(res.status, 404);
    const os = await linhaB('SELECT status FROM ordens_servico WHERE id = $1', [B.osAndamento.id]);
    assert.equal(os.status, 'EM_ANDAMENTO');
  });

  test('abrir OS para o equipamento da B: 404, e nada é gravado', async () => {
    const res = await request(app).post('/api/os').set(comoA('OPERADOR'))
      .send({ equipamentoId: B.equipamento.id, descricao: 'OS no equipamento de outra empresa' });
    assert.equal(res.status, 404);
    const { n } = await linhaB('SELECT COUNT(*)::int AS n FROM ordens_servico WHERE equipamento_id = $1', [B.equipamento.id]);
    assert.equal(n, 2);
  });

  test('fechar a própria OS usando a peça da B: 404 e ROLLBACK (estoque da B intacto)', async () => {
    const res = await request(app).post(`/api/os/${A.os.id}/fechar`).set(comoA('SUPERVISOR'))
      .send({ causa: 'Rolamento', solucao: 'Troca usando peça alheia', horas: 1, pecas: [{ pecaId: B.peca.id, qtd: 1 }] });
    assert.equal(res.status, 404);
    assert.equal((await linhaB('SELECT estoque FROM pecas WHERE id = $1', [B.peca.id])).estoque, 10);
    const minha = await request(app).get(`/api/os/${A.os.id}`).set(comoA('SUPERVISOR'));
    assert.equal(minha.body.status, 'EM_ANDAMENTO');
  });
});

describe('peças, alertas e equipamentos da outra empresa', () => {
  test('não aparecem nas listas', async () => {
    const pecas = await request(app).get('/api/pecas').set(comoA('SUPERVISOR'));
    assert.deepEqual(pecas.body.map((p) => p.id), [A.peca.id]);
    const equipamentos = await request(app).get('/api/equipamentos').set(comoA('SUPERVISOR'));
    assert.deepEqual(equipamentos.body.map((e) => e.id), [A.equipamento.id]);
    const alertas = await request(app).get('/api/alertas').set(comoA('SUPERVISOR'));
    assert.deepEqual(alertas.body, []);
  });

  test('entrada de estoque na peça da B: 404, estoque e movimentações da B intactos', async () => {
    const res = await request(app).post(`/api/pecas/${B.peca.id}/entrada`).set(comoA('SUPERVISOR')).send({ qtd: 50 });
    assert.equal(res.status, 404);
    assert.equal((await linhaB('SELECT estoque FROM pecas WHERE id = $1', [B.peca.id])).estoque, 10);
    const { n } = await linhaB('SELECT COUNT(*)::int AS n FROM movimentacoes WHERE peca_id = $1', [B.peca.id]);
    assert.equal(n, 0);
  });

  test('a mesma tag e o mesmo código podem existir nas duas empresas', async () => {
    const eq = await request(app).post('/api/equipamentos').set(comoA('SUPERVISOR'))
      .send({ tag: B.equipamento.tag, nome: 'Mesmo nome de tag, outra empresa', linha: 'Linha A', criticidade: 'C' });
    assert.equal(eq.status, 201);
    const peca = await request(app).post('/api/pecas').set(comoA('SUPERVISOR'))
      .send({ codigo: B.peca.codigo, descricao: 'Mesmo código, outra empresa', estoqueMin: 0, custoUnit: 1 });
    assert.equal(peca.status, 201);
  });

  test('indicadores e consultas BD2 só somam a própria empresa', async () => {
    const resumo = await request(app).get('/api/kpis/resumo').set(comoA('SUPERVISOR'));
    assert.equal(resumo.body.os_abertas, 0, 'as OS ABERTAS da B não entram');
    assert.equal(resumo.body.alertas_pendentes, 0, 'o alerta da B não entra');
    const kpis = await request(app).get('/api/kpis').set(comoA('SUPERVISOR'));
    assert.ok(!kpis.body.equipamentos.some((e) => e.equipamento_id === B.equipamento.id));
    const resumoB = await request(app).get('/api/kpis/resumo').set(comoB('SUPERVISOR'));
    assert.equal(resumoB.body.os_abertas, 1);
    assert.equal(resumoB.body.alertas_pendentes, 1);
  });
});

describe('usuários da outra empresa', () => {
  test('não aparecem na lista do supervisor', async () => {
    const res = await request(app).get('/api/usuarios').set(comoA('SUPERVISOR'));
    const ids = res.body.map((u) => u.id);
    for (const u of Object.values(B.usuarios)) assert.ok(!ids.includes(u.id));
    assert.equal(ids.length, Object.keys(A.usuarios).length);
  });

  test('desativar usuário da B: 404, e ele continua ativo', async () => {
    const res = await request(app).patch(`/api/usuarios/${B.usuarios.OPERADOR.id}/ativo`).set(comoA('SUPERVISOR'))
      .send({ ativo: false });
    assert.equal(res.status, 404);
    assert.equal((await linhaB('SELECT ativo FROM usuarios WHERE id = $1', [B.usuarios.OPERADOR.id])).ativo, true);
  });

  test('usuário criado pelo supervisor da A nasce na empresa A', async () => {
    const res = await request(app).post('/api/usuarios').set(comoA('SUPERVISOR'))
      .send({ nome: 'Novo da A', email: `novo-a-${process.pid}@cmms.local`, perfil: 'OPERADOR', senha: 'Senha2026segura' });
    assert.equal(res.status, 201);
    const { empresa_id: empresa } = (await pool.query('SELECT empresa_id FROM usuarios WHERE id = $1', [res.body.id])).rows[0];
    assert.equal(empresa, EMPRESA_ID);
  });
});

describe('token', () => {
  test('token com a empresa trocada (mesma assinatura): 401, a fn_sessao confere o vínculo', async () => {
    const forjado = jwt.sign(
      { nome: 'x', perfil: 'SUPERVISOR', emp: empresaB.id },
      config.jwtSecret,
      { subject: String(A.usuarios.SUPERVISOR.id), expiresIn: '5m', algorithm: 'HS256' },
    );
    const res = await request(app).get('/api/os').set('Authorization', `Bearer ${forjado}`);
    assert.equal(res.status, 401);
  });

  test('login devolve a empresa do usuário', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: B.usuarios.OPERADOR.email, senha: 'senha-de-teste-123' });
    assert.equal(res.body.usuario.empresaId, empresaB.id);
    assert.equal(res.body.usuario.empresaNome, empresaB.nome);
  });
});
