import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import {
  criarUsuarios, criarEquipamento, criarPeca, removerDados, encerrar, login, abrirOs,
} from './helpers.js';

let usuarios;
const equipamentos = [];
const pecas = [];
const tokens = {};

// ---- utilidades ------------------------------------------------------------------
const novoEquipamento = async () => { const e = await criarEquipamento(); equipamentos.push(e); return e; };
const novaPeca = async (dados) => { const p = await criarPeca(dados); pecas.push(p); return p; };

const fechar = (osId, token, corpo) => request(app)
  .post(`/api/os/${osId}/fechar`)
  .set('Authorization', `Bearer ${token}`)
  .send({ causa: 'Desgaste de rolamento', solucao: 'Troca do rolamento', horas: 2.5, ...corpo });

const assumir = async (osId, token = tokens.TECNICO) => {
  const r = await request(app).post(`/api/os/${osId}/assumir`).set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 200);
};

// OS aberta pelo operador e assumida pelo técnico (status EM_ANDAMENTO)
const osEmAndamento = async (equipamentoId, token = tokens.TECNICO) => {
  const os = await abrirOs(app, request, tokens.OPERADOR, equipamentoId);
  await assumir(os.id, token);
  return os;
};

const um = async (sql, params) => (await pool.query(sql, params)).rows[0];
const estoque = async (pecaId) => (await um('SELECT estoque FROM pecas WHERE id = $1', [pecaId])).estoque;
const statusOs = async (id) => (await um('SELECT status FROM ordens_servico WHERE id = $1', [id])).status;
const statusEquip = async (id) => (await um('SELECT status FROM equipamentos WHERE id = $1', [id])).status;
const contar = async (tabela, coluna, valores) => Number((await um(
  `SELECT COUNT(*) FROM ${tabela} WHERE ${coluna} = ANY($1::int[])`, [valores])).count);

// Fotografia de tudo o que o fechamento pode alterar
async function fotografia(osId, idsPecas) {
  return {
    estoques: (await pool.query('SELECT id, estoque FROM pecas WHERE id = ANY($1::int[]) ORDER BY id', [idsPecas])).rows,
    osPecas: await contar('os_pecas', 'os_id', [osId]),
    movimentacoes: await contar('movimentacoes', 'peca_id', idsPecas),
    alertas: await contar('alertas_estoque', 'peca_id', idsPecas),
  };
}

before(async () => {
  usuarios = await criarUsuarios();
  for (const chave of Object.keys(usuarios)) tokens[chave] = await login(app, request, usuarios[chave]);
});

after(async () => {
  await removerDados({ usuarios, equipamentos, pecas });
  await encerrar();
});

// ---- testes ----------------------------------------------------------------------
describe('POST /api/os/:id/fechar — sucesso', () => {
  test('fecha com 2 peças: baixa estoque, os_pecas com custo do momento, SAIDAs, OS FECHADA, equipamento OPERANDO', async () => {
    const eq = await novoEquipamento();
    const p1 = await novaPeca({ estoque: 10, custoUnit: 25.5 });
    const p2 = await novaPeca({ estoque: 5, custoUnit: 100 });
    const os = await osEmAndamento(eq.id);
    assert.equal(await statusEquip(eq.id), 'PARADO');

    const res = await fechar(os.id, tokens.TECNICO, {
      horas: 3, pecas: [{ pecaId: p2.id, qtd: 2 }, { pecaId: p1.id, qtd: 4 }],
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'FECHADA');
    assert.ok(res.body.fechada_em);
    assert.equal(Number(res.body.horas), 3);
    assert.equal(res.body.causa, 'Desgaste de rolamento');

    assert.equal(await estoque(p1.id), 6);
    assert.equal(await estoque(p2.id), 3);

    const osPecas = Object.fromEntries(res.body.pecas.map((p) => [p.peca_id, p]));
    assert.equal(osPecas[p1.id].qtd, 4);
    assert.equal(Number(osPecas[p1.id].custo_unit), 25.5);
    assert.equal(Number(osPecas[p2.id].custo_unit), 100);

    const saidas = (await pool.query(
      `SELECT peca_id, qtd, usuario_id FROM movimentacoes
        WHERE os_id = $1 AND tipo = 'SAIDA' ORDER BY peca_id`, [os.id])).rows;
    assert.deepEqual(saidas, [
      { peca_id: p1.id, qtd: 4, usuario_id: usuarios.TECNICO.id },
      { peca_id: p2.id, qtd: 2, usuario_id: usuarios.TECNICO.id },
    ]);

    assert.equal(await statusEquip(eq.id), 'OPERANDO');
    const ultima = res.body.auditoria.at(-1);
    assert.deepEqual([ultima.status_de, ultima.status_para, ultima.usuario_id],
      ['EM_ANDAMENTO', 'FECHADA', usuarios.TECNICO.id]);
  });

  test('fecha sem peças (lista vazia ou ausente)', async () => {
    const eq = await novoEquipamento();
    const os = await osEmAndamento(eq.id);
    const res = await fechar(os.id, tokens.TECNICO, {});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.pecas, []);
  });

  test('equipamento continua PARADO se houver outra OS ABERTA ou EM_ANDAMENTO para ele', async () => {
    const eq = await novoEquipamento();
    const osA = await osEmAndamento(eq.id);
    const osB = await abrirOs(app, request, tokens.OPERADOR, eq.id);           // ABERTA

    assert.equal((await fechar(osA.id, tokens.TECNICO)).status, 200);
    assert.equal(await statusEquip(eq.id), 'PARADO', 'osB ainda ABERTA');

    await assumir(osB.id, tokens.TECNICO2);                                    // EM_ANDAMENTO
    const osC = await osEmAndamento(eq.id);
    assert.equal((await fechar(osC.id, tokens.TECNICO)).status, 200);
    assert.equal(await statusEquip(eq.id), 'PARADO', 'osB ainda EM_ANDAMENTO');

    assert.equal((await fechar(osB.id, tokens.TECNICO2)).status, 200);
    assert.equal(await statusEquip(eq.id), 'OPERANDO', 'nenhuma OS pendente');
  });

  test('equipamento continua PARADO se houver outra OS AGUARDANDO_PECA para ele', async () => {
    const eq = await novoEquipamento();
    const semSaldo = await novaPeca({ estoque: 0 });

    // osA fica AGUARDANDO_PECA (tentativa de fechar sem estoque)
    const osA = await osEmAndamento(eq.id);
    assert.equal((await fechar(osA.id, tokens.TECNICO, { pecas: [{ pecaId: semSaldo.id, qtd: 1 }] })).status, 409);
    assert.equal(await statusOs(osA.id), 'AGUARDANDO_PECA');

    // osB é fechada normalmente, mas osA ainda segura o equipamento
    const osB = await osEmAndamento(eq.id, tokens.TECNICO2);
    assert.equal((await fechar(osB.id, tokens.TECNICO2)).status, 200);
    assert.equal(await statusEquip(eq.id), 'PARADO', 'osA ainda AGUARDANDO_PECA');

    // reposição e fechamento de osA liberam o equipamento
    await pool.query('CALL sp_entrada_estoque($1, $2, $3)', [semSaldo.id, 1, usuarios.SUPERVISOR.id]);
    assert.equal((await fechar(osA.id, tokens.TECNICO, { pecas: [{ pecaId: semSaldo.id, qtd: 1 }] })).status, 200);
    assert.equal(await statusEquip(eq.id), 'OPERANDO');
  });

  test('supervisor pode fechar OS assumida por um técnico', async () => {
    const eq = await novoEquipamento();
    const os = await osEmAndamento(eq.id);
    const res = await fechar(os.id, tokens.SUPERVISOR);
    assert.equal(res.status, 200);
    assert.equal(res.body.auditoria.at(-1).usuario_id, usuarios.SUPERVISOR.id);
  });
});

describe('POST /api/os/:id/fechar — estoque insuficiente (ROLLBACK)', () => {
  test('409, NADA muda em estoque/os_pecas/movimentacoes/alertas e a OS vai para AGUARDANDO_PECA', async () => {
    const eq = await novoEquipamento();
    // pA tem saldo e seria baixada PRIMEIRO (menor id); pB não tem saldo.
    // Se não houvesse rollback, o estoque de pA ficaria 4 e haveria alerta (cruza o mínimo 5).
    const pA = await novaPeca({ estoque: 6, estoqueMin: 5 });
    const pB = await novaPeca({ estoque: 1 });
    const os = await osEmAndamento(eq.id);
    const antes = await fotografia(os.id, [pA.id, pB.id]);

    const res = await fechar(os.id, tokens.TECNICO, {
      pecas: [{ pecaId: pA.id, qtd: 2 }, { pecaId: pB.id, qtd: 3 }],
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.erro.codigo, 'ESTOQUE_INSUFICIENTE');
    assert.deepEqual(res.body.erro.detalhes, { pecaId: pB.id, codigo: pB.codigo, solicitado: 3, disponivel: 1 });

    assert.deepEqual(await fotografia(os.id, [pA.id, pB.id]), antes, 'nada do fechamento ficou gravado');
    assert.equal(await statusOs(os.id), 'AGUARDANDO_PECA');
    assert.equal(await statusEquip(eq.id), 'PARADO');

    const aud = (await pool.query(
      'SELECT status_de, status_para, usuario_id FROM os_auditoria WHERE os_id = $1 ORDER BY id', [os.id])).rows;
    assert.deepEqual(aud.at(-1), { status_de: 'EM_ANDAMENTO', status_para: 'AGUARDANDO_PECA', usuario_id: usuarios.TECNICO.id });
  });

  test('ciclo completo: sem estoque -> 409/AGUARDANDO_PECA -> CALL sp_entrada_estoque -> fecha 200, alerta resolvido', async () => {
    const eq = await novoEquipamento();
    const peca = await novaPeca({ estoque: 4, estoqueMin: 3 });

    // 1ª OS consome 2: estoque 4 -> 2 cruza o mínimo 3 e a trigger cria o alerta
    const os1 = await osEmAndamento(eq.id);
    assert.equal((await fechar(os1.id, tokens.TECNICO, { pecas: [{ pecaId: peca.id, qtd: 2 }] })).status, 200);
    const alerta = await um('SELECT id, resolvido FROM alertas_estoque WHERE peca_id = $1', [peca.id]);
    assert.equal(alerta.resolvido, false);

    // 2ª OS pede 5, só há 2: 409 e AGUARDANDO_PECA
    const os2 = await osEmAndamento(eq.id);
    const falha = await fechar(os2.id, tokens.TECNICO, { pecas: [{ pecaId: peca.id, qtd: 5 }] });
    assert.equal(falha.status, 409);
    assert.equal(await statusOs(os2.id), 'AGUARDANDO_PECA');
    assert.equal(await estoque(peca.id), 2);

    // supervisor repõe o estoque pela procedure: 2 + 10 = 12 >= 3 resolve o alerta
    await pool.query('CALL sp_entrada_estoque($1, $2, $3)', [peca.id, 10, usuarios.SUPERVISOR.id]);
    assert.equal(await estoque(peca.id), 12);

    // técnico tenta de novo: aceita AGUARDANDO_PECA e fecha
    const ok = await fechar(os2.id, tokens.TECNICO, { pecas: [{ pecaId: peca.id, qtd: 5 }] });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'FECHADA');
    assert.equal(await estoque(peca.id), 7);

    const alertas = (await pool.query('SELECT id, resolvido FROM alertas_estoque WHERE peca_id = $1', [peca.id])).rows;
    assert.deepEqual(alertas, [{ id: alerta.id, resolvido: true }], 'alerta resolvido e nenhum novo (7 >= 3)');

    assert.deepEqual(ok.body.auditoria.map((a) => `${a.status_de}>${a.status_para}`), [
      'ABERTA>EM_ANDAMENTO', 'EM_ANDAMENTO>AGUARDANDO_PECA', 'AGUARDANDO_PECA>FECHADA',
    ]);
    assert.equal(await statusEquip(eq.id), 'OPERANDO');
  });
});

describe('POST /api/os/:id/fechar — permissões, status e validação', () => {
  test('outro técnico (não o que assumiu) e operador: 403 e nada muda', async () => {
    const eq = await novoEquipamento();
    const peca = await novaPeca({ estoque: 5 });
    const os = await osEmAndamento(eq.id, tokens.TECNICO);
    const antes = await fotografia(os.id, [peca.id]);

    for (const chave of ['TECNICO2', 'OPERADOR']) {
      const res = await fechar(os.id, tokens[chave], { pecas: [{ pecaId: peca.id, qtd: 1 }] });
      assert.equal(res.status, 403, chave);
    }
    assert.deepEqual(await fotografia(os.id, [peca.id]), antes);
    assert.equal(await statusOs(os.id), 'EM_ANDAMENTO');
  });

  test('OS ABERTA ou já FECHADA: 409 STATUS_INVALIDO', async () => {
    const eq = await novoEquipamento();
    const aberta = await abrirOs(app, request, tokens.OPERADOR, eq.id);
    const r1 = await fechar(aberta.id, tokens.SUPERVISOR);
    assert.equal(r1.status, 409);
    assert.equal(r1.body.erro.codigo, 'STATUS_INVALIDO');

    const os = await osEmAndamento(eq.id);
    assert.equal((await fechar(os.id, tokens.TECNICO)).status, 200);
    const r2 = await fechar(os.id, tokens.TECNICO);
    assert.equal(r2.status, 409);
    assert.equal(r2.body.erro.detalhes.statusAtual, 'FECHADA');
  });

  test('peça inexistente: 404, ROLLBACK e a OS NÃO vai para AGUARDANDO_PECA', async () => {
    const eq = await novoEquipamento();
    const peca = await novaPeca({ estoque: 5 });
    const os = await osEmAndamento(eq.id);
    const res = await fechar(os.id, tokens.TECNICO, {
      pecas: [{ pecaId: peca.id, qtd: 1 }, { pecaId: 999999, qtd: 1 }],
    });
    assert.equal(res.status, 404);
    assert.equal(await estoque(peca.id), 5);
    assert.equal(await statusOs(os.id), 'EM_ANDAMENTO');
  });

  test('dados inválidos: 400 (horas, causa, peça repetida, qtd 0)', async () => {
    const eq = await novoEquipamento();
    const os = await osEmAndamento(eq.id);
    const res = await fechar(os.id, tokens.TECNICO, {
      horas: -1, causa: '', pecas: [{ pecaId: 1, qtd: 1 }, { pecaId: 1, qtd: 0 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.erro.detalhes.length, 4);
    assert.equal(await statusOs(os.id), 'EM_ANDAMENTO');
  });
});
