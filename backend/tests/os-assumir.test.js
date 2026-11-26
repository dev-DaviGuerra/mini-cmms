import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool, criarUsuarios, criarEquipamento, removerDados, encerrar, login, abrirOs } from './helpers.js';

let usuarios;
let equipamento;
const tokens = {};

const assumir = (osId, token) => request(app)
  .post(`/api/os/${osId}/assumir`)
  .set('Authorization', `Bearer ${token}`);

const lerOs = async (id) => (await pool.query(
  'SELECT status, tecnico_id, iniciada_em FROM ordens_servico WHERE id = $1', [id])).rows[0];

before(async () => {
  usuarios = await criarUsuarios();
  equipamento = await criarEquipamento();
  for (const chave of Object.keys(usuarios)) tokens[chave] = await login(app, request, usuarios[chave]);
});

after(async () => {
  await removerDados({ usuarios, equipamentos: [equipamento] });
  await encerrar();
});

describe('POST /api/os/:id/assumir', () => {
  test('técnico assume OS ABERTA: EM_ANDAMENTO, tecnico_id, iniciada_em e auditoria com o usuário', async () => {
    const os = await abrirOs(app, request, tokens.OPERADOR, equipamento.id);

    const res = await assumir(os.id, tokens.TECNICO);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'EM_ANDAMENTO');
    assert.equal(res.body.tecnico_id, usuarios.TECNICO.id);
    assert.ok(res.body.iniciada_em);
    assert.ok(new Date(res.body.iniciada_em) >= new Date(res.body.aberta_em));

    // trigger trg_auditoria_os gravou a mudança COM o usuário (set_config dentro da transação)
    assert.equal(res.body.auditoria.length, 1);
    assert.equal(res.body.auditoria[0].status_de, 'ABERTA');
    assert.equal(res.body.auditoria[0].status_para, 'EM_ANDAMENTO');
    assert.equal(res.body.auditoria[0].usuario_id, usuarios.TECNICO.id);
  });

  test('OS que não está ABERTA: 409 STATUS_INVALIDO e nada muda', async () => {
    const os = await abrirOs(app, request, tokens.OPERADOR, equipamento.id);
    assert.equal((await assumir(os.id, tokens.TECNICO)).status, 200);
    const antes = await lerOs(os.id);

    const res = await assumir(os.id, tokens.TECNICO2);
    assert.equal(res.status, 409);
    assert.equal(res.body.erro.codigo, 'STATUS_INVALIDO');
    assert.equal(res.body.erro.detalhes.statusAtual, 'EM_ANDAMENTO');
    assert.deepEqual(await lerOs(os.id), antes);   // continua com o primeiro técnico
  });

  test('dois técnicos ao mesmo tempo: só um consegue (FOR UPDATE), o outro recebe 409', async () => {
    const os = await abrirOs(app, request, tokens.OPERADOR, equipamento.id);

    const respostas = await Promise.all([assumir(os.id, tokens.TECNICO), assumir(os.id, tokens.TECNICO2)]);
    const status = respostas.map((r) => r.status).sort();
    assert.deepEqual(status, [200, 409]);

    const vencedor = respostas.find((r) => r.status === 200).body.tecnico_id;
    assert.equal((await lerOs(os.id)).tecnico_id, vencedor);
    const auditoria = await pool.query('SELECT COUNT(*)::int AS n FROM os_auditoria WHERE os_id = $1', [os.id]);
    assert.equal(auditoria.rows[0].n, 1, 'só uma mudança de status registrada');
  });

  test('OPERADOR e SUPERVISOR não assumem: 403 e a OS continua ABERTA', async () => {
    const os = await abrirOs(app, request, tokens.OPERADOR, equipamento.id);
    for (const chave of ['OPERADOR', 'SUPERVISOR']) {
      const res = await assumir(os.id, tokens[chave]);
      assert.equal(res.status, 403, `${chave} não deveria assumir`);
    }
    const atual = await lerOs(os.id);
    assert.equal(atual.status, 'ABERTA');
    assert.equal(atual.tecnico_id, null);
  });

  test('OS inexistente: 404 · id inválido: 400 · sem token: 401', async () => {
    assert.equal((await assumir(999999, tokens.TECNICO)).status, 404);
    assert.equal((await assumir('abc', tokens.TECNICO)).status, 400);
    assert.equal((await request(app).post('/api/os/1/assumir')).status, 401);
  });
});

describe('GET /api/os paginação', () => {
  test('limit/offset percorrem as páginas sem repetir e total é o número de OS do filtro', async () => {
    const filtro = `equipamentoId=${equipamento.id}`;
    const total = Number((await pool.query(
      'SELECT COUNT(*) FROM ordens_servico WHERE equipamento_id = $1', [equipamento.id])).rows[0].count);
    assert.ok(total >= 4);

    const p1 = await request(app).get(`/api/os?${filtro}&limit=2&offset=0`).set('Authorization', `Bearer ${tokens.TECNICO}`);
    const p2 = await request(app).get(`/api/os?${filtro}&limit=2&offset=2`).set('Authorization', `Bearer ${tokens.TECNICO}`);
    assert.equal(p1.status, 200);
    assert.deepEqual(p1.body.paginacao, { limit: 2, offset: 0, total });
    assert.equal(p1.body.dados.length, 2);
    assert.equal(p2.body.dados.length, 2);
    const ids = [...p1.body.dados, ...p2.body.dados].map((o) => o.id);
    assert.equal(new Set(ids).size, 4, 'páginas não se repetem');
  });

  test('padrão é limit 50 / offset 0; limit acima de 200 ou negativo: 400', async () => {
    const padrao = await request(app).get('/api/os').set('Authorization', `Bearer ${tokens.TECNICO}`);
    assert.equal(padrao.body.paginacao.limit, 50);
    assert.equal(padrao.body.paginacao.offset, 0);

    for (const q of ['limit=500', 'limit=0', 'offset=-1', 'limit=abc']) {
      const res = await request(app).get(`/api/os?${q}`).set('Authorization', `Bearer ${tokens.TECNICO}`);
      assert.equal(res.status, 400, q);
    }
  });
});
