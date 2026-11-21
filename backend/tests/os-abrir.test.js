import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { criarUsuarios, criarEquipamento, removerDados, encerrar, login } from './helpers.js';

let usuarios;
let equipamento;
let outroEquipamento;
const tokens = {};

const contarOs = async (equipamentoId) => Number(
  (await pool.query('SELECT COUNT(*) FROM ordens_servico WHERE equipamento_id = $1', [equipamentoId])).rows[0].count,
);
const statusEquipamento = async (id) => (
  await pool.query('SELECT status FROM equipamentos WHERE id = $1', [id])).rows[0].status;

before(async () => {
  usuarios = await criarUsuarios();
  equipamento = await criarEquipamento();
  outroEquipamento = await criarEquipamento();
  for (const perfil of Object.keys(usuarios)) tokens[perfil] = await login(app, request, usuarios[perfil]);
});

after(async () => {
  await removerDados({ usuarios, equipamentos: [equipamento, outroEquipamento] });
  await encerrar();
});

describe('POST /api/os (abrir OS)', () => {
  test('operador abre OS: 201, status ABERTA e equipamento passa a PARADO', async () => {
    assert.equal(await statusEquipamento(equipamento.id), 'OPERANDO');

    const res = await request(app)
      .post('/api/os')
      .set('Authorization', `Bearer ${tokens.OPERADOR}`)
      .send({ equipamentoId: equipamento.id, descricao: 'Robô parou com alarme', prioridade: 'ALTA' });

    assert.equal(res.status, 201);
    assert.equal(res.headers.location, `/api/os/${res.body.id}`);
    assert.equal(res.body.status, 'ABERTA');
    assert.equal(res.body.tipo, 'CORRETIVA');          // padrão
    assert.equal(res.body.prioridade, 'ALTA');
    assert.equal(res.body.aberta_por, usuarios.OPERADOR.id);
    assert.equal(res.body.tecnico_id, null);
    assert.ok(res.body.aberta_em);
    assert.deepEqual(res.body.auditoria, []);          // INSERT não gera auditoria de status

    assert.equal(await statusEquipamento(equipamento.id), 'PARADO');
  });

  test('supervisor também pode abrir OS (ex.: preventiva)', async () => {
    const res = await request(app)
      .post('/api/os')
      .set('Authorization', `Bearer ${tokens.SUPERVISOR}`)
      .send({ equipamentoId: outroEquipamento.id, descricao: 'Preventiva mensal', tipo: 'PREVENTIVA', prioridade: 'BAIXA' });
    assert.equal(res.status, 201);
    assert.equal(res.body.tipo, 'PREVENTIVA');
  });

  test('técnico não pode abrir OS: 403 e nada é gravado', async () => {
    const antes = await contarOs(outroEquipamento.id);
    const res = await request(app)
      .post('/api/os')
      .set('Authorization', `Bearer ${tokens.TECNICO}`)
      .send({ equipamentoId: outroEquipamento.id, descricao: 'Tentativa do técnico' });
    assert.equal(res.status, 403);
    assert.equal(res.body.erro.codigo, 'PROIBIDO');
    assert.equal(await contarOs(outroEquipamento.id), antes);
  });

  test('sem token: 401', async () => {
    const res = await request(app).post('/api/os').send({ equipamentoId: equipamento.id, descricao: 'Sem login' });
    assert.equal(res.status, 401);
  });

  test('dados inválidos: 400 listando todos os problemas', async () => {
    const res = await request(app)
      .post('/api/os')
      .set('Authorization', `Bearer ${tokens.OPERADOR}`)
      .send({ equipamentoId: 'abc', descricao: 'x', prioridade: 'URGENTISSIMA', tipo: 'OUTRO' });
    assert.equal(res.status, 400);
    assert.equal(res.body.erro.codigo, 'VALIDACAO');
    assert.equal(res.body.erro.detalhes.length, 4);
  });

  test('equipamento inexistente: 404 e nenhuma OS criada', async () => {
    const totalAntes = Number((await pool.query('SELECT COUNT(*) FROM ordens_servico')).rows[0].count);
    const res = await request(app)
      .post('/api/os')
      .set('Authorization', `Bearer ${tokens.OPERADOR}`)
      .send({ equipamentoId: 999999, descricao: 'Equipamento que não existe' });
    assert.equal(res.status, 404);
    const totalDepois = Number((await pool.query('SELECT COUNT(*) FROM ordens_servico')).rows[0].count);
    assert.equal(totalDepois, totalAntes);
  });
});

describe('GET /api/os e /api/os/:id', () => {
  test('lista com filtros por equipamento e status', async () => {
    const res = await request(app)
      .get(`/api/os?equipamentoId=${equipamento.id}&status=ABERTA`)
      .set('Authorization', `Bearer ${tokens.TECNICO}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.dados.length, 1);
    assert.deepEqual(res.body.paginacao, { limit: 50, offset: 0, total: 1 });
    assert.equal(res.body.dados[0].equipamento_tag, equipamento.tag);
  });

  test('filtro inválido: 400', async () => {
    const res = await request(app).get('/api/os?status=QUALQUER').set('Authorization', `Bearer ${tokens.TECNICO}`);
    assert.equal(res.status, 400);
  });

  test('detalhe: 200 com peças e auditoria; inexistente 404; id inválido 400', async () => {
    const lista = await request(app)
      .get(`/api/os?equipamentoId=${equipamento.id}`)
      .set('Authorization', `Bearer ${tokens.OPERADOR}`);
    const id = lista.body.dados[0].id;

    const ok = await request(app).get(`/api/os/${id}`).set('Authorization', `Bearer ${tokens.OPERADOR}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.pecas, []);
    assert.ok(Array.isArray(ok.body.auditoria));

    const nf = await request(app).get('/api/os/999999').set('Authorization', `Bearer ${tokens.OPERADOR}`);
    assert.equal(nf.status, 404);

    const inv = await request(app).get('/api/os/abc').set('Authorization', `Bearer ${tokens.OPERADOR}`);
    assert.equal(inv.status, 400);
  });
});
