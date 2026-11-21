import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { criarUsuarios, criarPeca, removerDados, encerrar, login } from './helpers.js';

let usuarios;
const tokens = {};
const equipamentos = [];   // criados pela API, removidos no final
const pecas = [];
const sufixo = String(process.pid).slice(-5);

const como = (chave) => ({ Authorization: `Bearer ${tokens[chave]}` });
const um = async (sql, params) => (await pool.query(sql, params)).rows[0];

before(async () => {
  usuarios = await criarUsuarios();
  for (const chave of Object.keys(usuarios)) tokens[chave] = await login(app, request, usuarios[chave]);
});

after(async () => {
  await removerDados({ usuarios, equipamentos, pecas });
  await encerrar();
});

describe('equipamentos', () => {
  test('supervisor cadastra: 201, tag em maiúsculas, status OPERANDO', async () => {
    const res = await request(app).post('/api/equipamentos').set(como('SUPERVISOR'))
      .send({ tag: `eq-${sufixo}`, nome: 'Equipamento novo', linha: 'Linha 9', criticidade: 'A' });
    assert.equal(res.status, 201);
    equipamentos.push(res.body);
    assert.equal(res.body.tag, `EQ-${sufixo}`);
    assert.equal(res.body.status, 'OPERANDO');
  });

  test('tag duplicada: 409 TAG_DUPLICADA', async () => {
    const res = await request(app).post('/api/equipamentos').set(como('SUPERVISOR'))
      .send({ tag: `EQ-${sufixo}`, nome: 'Outro', linha: 'Linha 9', criticidade: 'B' });
    assert.equal(res.status, 409);
    assert.equal(res.body.erro.codigo, 'TAG_DUPLICADA');
  });

  test('operador e técnico não cadastram: 403', async () => {
    for (const chave of ['OPERADOR', 'TECNICO']) {
      const res = await request(app).post('/api/equipamentos').set(como(chave))
        .send({ tag: `X-${sufixo}`, nome: 'Não pode', linha: 'Linha 9', criticidade: 'C' });
      assert.equal(res.status, 403, chave);
    }
    assert.equal(await um('SELECT id FROM equipamentos WHERE tag = $1', [`X-${sufixo}`]), undefined);
  });

  test('dados inválidos: 400', async () => {
    const res = await request(app).post('/api/equipamentos').set(como('SUPERVISOR'))
      .send({ tag: '', nome: 'ab', criticidade: 'Z' });
    assert.equal(res.status, 400);
    assert.equal(res.body.erro.detalhes.length, 4);
  });

  test('qualquer perfil lista, com os_pendentes; sem token: 401', async () => {
    const res = await request(app).get('/api/equipamentos').set(como('OPERADOR'));
    assert.equal(res.status, 200);
    const eq = res.body.find((e) => e.tag === `EQ-${sufixo}`);
    assert.equal(eq.os_pendentes, 0);
    assert.equal((await request(app).get('/api/equipamentos')).status, 401);
  });
});

describe('peças', () => {
  test('supervisor cadastra peça com estoque 0; código duplicado 409; técnico 403; inválido 400', async () => {
    const corpo = { codigo: `pc-${sufixo}`, descricao: 'Peça nova', estoqueMin: 2, custoUnit: 12.5 };
    const ok = await request(app).post('/api/pecas').set(como('SUPERVISOR')).send(corpo);
    assert.equal(ok.status, 201);
    pecas.push(ok.body);
    assert.equal(ok.body.codigo, `PC-${sufixo}`);
    assert.equal(ok.body.estoque, 0);
    assert.equal(Number(ok.body.custo_unit), 12.5);
    assert.equal(ok.body.abaixo_minimo, true);

    const dup = await request(app).post('/api/pecas').set(como('SUPERVISOR')).send(corpo);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.erro.codigo, 'CODIGO_DUPLICADO');

    const tec = await request(app).post('/api/pecas').set(como('TECNICO')).send({ ...corpo, codigo: `Y-${sufixo}` });
    assert.equal(tec.status, 403);

    const inv = await request(app).post('/api/pecas').set(como('SUPERVISOR'))
      .send({ codigo: 'x', descricao: '', estoqueMin: -1, custoUnit: 'dez' });
    assert.equal(inv.status, 400);
    assert.equal(inv.body.erro.detalhes.length, 4);
  });

  test('qualquer perfil lista peças com abaixo_minimo', async () => {
    const res = await request(app).get('/api/pecas').set(como('TECNICO'));
    assert.equal(res.status, 200);
    assert.ok(res.body.some((p) => p.codigo === `PC-${sufixo}` && p.abaixo_minimo === true));
  });
});

describe('entrada de estoque (CALL sp_entrada_estoque) e alertas', () => {
  test('alerta pendente aparece em /api/alertas; entrada resolve o alerta e grava ENTRADA', async () => {
    const peca = await criarPeca({ estoque: 4, estoqueMin: 3 });
    pecas.push(peca);
    await pool.query('UPDATE pecas SET estoque = 2 WHERE id = $1', [peca.id]); // cruza o mínimo: trigger cria alerta

    const antes = await request(app).get('/api/alertas').set(como('SUPERVISOR'));
    assert.equal(antes.status, 200);
    const alerta = antes.body.find((a) => a.peca_id === peca.id);
    assert.ok(alerta, 'alerta pendente listado');
    assert.equal(alerta.estoque, 2);

    // entrada de 1: estoque 3 >= mínimo 3 -> resolve
    const res = await request(app).post(`/api/pecas/${peca.id}/entrada`).set(como('SUPERVISOR')).send({ qtd: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.peca.estoque, 3);
    assert.equal(res.body.peca.abaixo_minimo, false);
    assert.equal(res.body.alertasResolvidos, 1);

    const mov = await um(
      "SELECT qtd, usuario_id, os_id FROM movimentacoes WHERE peca_id = $1 AND tipo = 'ENTRADA'", [peca.id]);
    assert.deepEqual(mov, { qtd: 1, usuario_id: usuarios.SUPERVISOR.id, os_id: null });

    const depois = await request(app).get('/api/alertas').set(como('SUPERVISOR'));
    assert.equal(depois.body.find((a) => a.peca_id === peca.id), undefined, 'alerta saiu da lista');
  });

  test('entrada que não chega ao mínimo mantém o alerta pendente', async () => {
    const peca = await criarPeca({ estoque: 5, estoqueMin: 5 });
    pecas.push(peca);
    await pool.query('UPDATE pecas SET estoque = 1 WHERE id = $1', [peca.id]);

    const res = await request(app).post(`/api/pecas/${peca.id}/entrada`).set(como('SUPERVISOR')).send({ qtd: 2 });
    assert.equal(res.status, 200);
    assert.equal(res.body.peca.estoque, 3);
    assert.equal(res.body.alertasResolvidos, 0);
  });

  test('técnico não dá entrada nem vê alertas: 403; qtd inválida 400; peça inexistente 404 — estoque não muda', async () => {
    const peca = await criarPeca({ estoque: 7 });
    pecas.push(peca);

    assert.equal((await request(app).post(`/api/pecas/${peca.id}/entrada`).set(como('TECNICO')).send({ qtd: 5 })).status, 403);
    assert.equal((await request(app).get('/api/alertas').set(como('TECNICO'))).status, 403);
    for (const corpo of [{}, { qtd: 0 }, { qtd: 2.5 }, { qtd: 'dez' }]) {
      const r = await request(app).post(`/api/pecas/${peca.id}/entrada`).set(como('SUPERVISOR')).send(corpo);
      assert.equal(r.status, 400, JSON.stringify(corpo));
    }
    assert.equal((await request(app).post('/api/pecas/999999/entrada').set(como('SUPERVISOR')).send({ qtd: 1 })).status, 404);

    assert.equal((await um('SELECT estoque FROM pecas WHERE id = $1', [peca.id])).estoque, 7);
    assert.equal(await um("SELECT id FROM movimentacoes WHERE peca_id = $1", [peca.id]), undefined);
  });
});
