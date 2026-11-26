// Testes das rotas de KPIs. Cria um cenário pequeno e controlado no cmms_test, com horários
// relativos a now(), e confere os números calculados à mão.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { separarConsultas, CONSULTAS_BD2 } from '../src/consultasBd2.js';
import { criarUsuarios, criarEquipamento, criarPeca, removerDados, encerrar, login } from './helpers.js';

let usuarios;
let e1; let e2; let e3;
let p1; let p2;
const tokens = {};

// data local AAAA-MM-DD de N dias atrás (as saídas do cenário ficam longe das bordas)
function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const get = (rota, chave = 'OPERADOR') => request(app).get(rota).set('Authorization', `Bearer ${tokens[chave]}`);

// Insere uma OS direto no banco, com horários relativos a now() (em horas)
async function inserirOs({ equipamento, tipo = 'CORRETIVA', status = 'FECHADA', abertaHa, reparoH, horas, causa }) {
  const { rows } = await pool.query(
    `INSERT INTO ordens_servico (equipamento_id, aberta_por, tecnico_id, tipo, prioridade, status, descricao,
                                 causa, solucao, aberta_em, iniciada_em, fechada_em, horas)
     VALUES ($1, $2, $3, $4, 'MEDIA', $5::varchar, 'OS do teste de KPI', $6, $7,
             now() - make_interval(hours => $8),
             CASE WHEN $5::varchar = 'ABERTA' THEN NULL ELSE now() - make_interval(hours => $8) END,
             CASE WHEN $5::varchar = 'FECHADA' THEN now() - make_interval(hours => $8) + make_interval(hours => $9) END,
             $10)
     RETURNING id`,
    [equipamento.id, usuarios.OPERADOR.id, status === 'ABERTA' ? null : usuarios.TECNICO.id, tipo, status,
      causa ?? null, status === 'FECHADA' ? 'Solução do teste' : null, abertaHa, reparoH ?? 0, horas ?? null],
  );
  return rows[0].id;
}

async function saida(peca, qtd, osId, diasAtras) {
  await pool.query(
    `INSERT INTO movimentacoes (peca_id, tipo, qtd, os_id, usuario_id, data)
     VALUES ($1, 'SAIDA', $2, $3, $4, now() - make_interval(days => $5))`,
    [peca.id, qtd, osId, usuarios.TECNICO.id, diasAtras],
  );
}

before(async () => {
  usuarios = await criarUsuarios();
  for (const chave of Object.keys(usuarios)) tokens[chave] = await login(app, request, usuarios[chave]);
  [e1, e2, e3] = [await criarEquipamento(), await criarEquipamento(), await criarEquipamento()];
  p1 = await criarPeca({ estoque: 50, custoUnit: 10 });
  p2 = await criarPeca({ estoque: 50, custoUnit: 4 });

  // E1: 2 falhas corretivas com reparo de 2h e 4h (MTTR 3h); horas técnicas 2 + 3
  const os1 = await inserirOs({ equipamento: e1, abertaHa: 240, reparoH: 2, horas: 2, causa: 'Causa A' });
  await inserirOs({ equipamento: e1, abertaHa: 120, reparoH: 4, horas: 3, causa: 'Causa A' });
  await pool.query('INSERT INTO os_pecas (os_id, peca_id, qtd, custo_unit) VALUES ($1, $2, 2, 10)', [os1, p1.id]);
  // E1: preventiva fechada não conta como falha, mas conta no custo (1h)
  await inserirOs({ equipamento: e1, tipo: 'PREVENTIVA', abertaHa: 48, reparoH: 1, horas: 1 });

  // E3: 1 falha com reparo de 1h (MTTR 1h) => média dos MTTR = (3 + 1) / 2 = 2
  await inserirOs({ equipamento: e3, abertaHa: 72, reparoH: 1, horas: 1, causa: 'Causa B' });

  // E2: sem falhas, mas com OS pendentes para o resumo
  await inserirOs({ equipamento: e2, status: 'ABERTA', abertaHa: 3 });
  await inserirOs({ equipamento: e2, status: 'EM_ANDAMENTO', abertaHa: 5 });
  await inserirOs({ equipamento: e2, status: 'AGUARDANDO_PECA', abertaHa: 7 });
  await pool.query("UPDATE equipamentos SET status = 'PARADO' WHERE id = $1", [e2.id]);
  await pool.query('INSERT INTO alertas_estoque (peca_id) VALUES ($1)', [p2.id]);

  // Consumo: p1 = 5 nos últimos 30 dias; p2 = 2 recentes + 100 há 40 dias (fora da janela)
  await saida(p1, 5, os1, 3);
  await saida(p2, 2, os1, 10);
  await saida(p2, 100, os1, 40);
});

after(async () => {
  await removerDados({ usuarios, equipamentos: [e1, e2, e3], pecas: [p1, p2] });
  await encerrar();
});

describe('GET /api/kpis (sp_kpis_equipamento)', () => {
  test('padrão: últimos 90 dias, com MTTR, MTBF, disponibilidade e custo corretos', async () => {
    const res = await get('/api/kpis');
    assert.equal(res.status, 200);
    assert.match(res.body.inicio, /^\d{4}-\d{2}-\d{2}$/);
    const dias = (new Date(res.body.fim) - new Date(res.body.inicio)) / 86400000;
    assert.equal(dias, 90);

    const k1 = res.body.equipamentos.find((e) => e.equipamento_id === e1.id);
    // período inclusivo = 91 dias = 2184 h; tempo operando = 2184 - 6 = 2178; MTBF = 2178 / 2
    assert.deepEqual(
      { n: k1.n_falhas, mttr: k1.mttr_h, mtbf: k1.mtbf_h, disp: k1.disponibilidade, custo: k1.custo_total },
      { n: 2, mttr: 3, mtbf: 1089, disp: 99.73, custo: (2 + 3 + 1) * 80 + 2 * 10 },
    );
    assert.equal(typeof k1.mttr_h, 'number', 'NUMERIC convertido para número');

    const k2 = res.body.equipamentos.find((e) => e.equipamento_id === e2.id);
    assert.deepEqual([k2.n_falhas, k2.mttr_h, k2.mtbf_h, k2.disponibilidade], [0, null, null, 100]);
  });

  test('período informado que não contém as OS: nenhuma falha', async () => {
    const res = await get('/api/kpis?inicio=2020-01-01&fim=2020-01-31');
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.inicio, res.body.fim], ['2020-01-01', '2020-01-31']);
    assert.equal(res.body.equipamentos.find((e) => e.equipamento_id === e1.id).n_falhas, 0);
  });

  test('datas inválidas: 400', async () => {
    for (const q of ['inicio=2026-13-01', 'fim=ontem', 'inicio=2026-02-30', 'inicio=2026-05-10&fim=2026-05-01']) {
      const res = await get(`/api/kpis?${q}`);
      assert.equal(res.status, 400, q);
    }
  });
});

describe('GET /api/kpis/resumo', () => {
  test('totais para os cards do dashboard', async () => {
    const res = await get('/api/kpis/resumo', 'TECNICO');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      os_abertas: 1, os_em_andamento: 1, os_aguardando_peca: 1, equipamentos_parados: 1, alertas_pendentes: 1,
    });
  });
});

describe('consultas BD2 (SQL de database/04_consultas_bd2.sql)', () => {
  test('parser: ignora \\echo, tira o ; final e os comentários depois dele, aceita CRLF', () => {
    const c = separarConsultas([
      '-- cabeçalho',
      '-- @consulta a',
      "\\echo 'titulo'",
      'SELECT 1',
      '  FROM pecas;',
      '',
      '-- comentário da próxima consulta',
      '-- @consulta b',
      'WITH x AS (SELECT 2) SELECT * FROM x;',
    ].join('\r\n'));
    assert.deepEqual(c, { a: 'SELECT 1\n  FROM pecas', b: 'WITH x AS (SELECT 2) SELECT * FROM x' });
  });

  test('parser: rejeita comando que não é SELECT/WITH, dois comandos, falta de ; e nome inválido', () => {
    assert.throws(() => separarConsultas('-- @consulta ruim\nDELETE FROM pecas;'), /não é um SELECT/);
    assert.throws(() => separarConsultas('-- @consulta x\nSELECT 1;\nDROP TABLE pecas;'), /mais de um comando/);
    assert.throws(() => separarConsultas('-- @consulta x\nSELECT 1'), /não termina com ;/);
    assert.throws(() => separarConsultas('-- @consulta Nome_Ruim\nSELECT 1;'), /Nome de consulta inválido/);
    assert.throws(() => separarConsultas('-- @consulta x\nSELECT 1;\n-- @consulta x\nSELECT 2;'), /duplicada/);
  });

  test('parser: tempo linear mesmo com entrada patológica (sem ReDoS)', () => {
    // Com a regex antiga /;\s*(--[^\n]*\s*)*$/, uma entrada assim, com só 49 caracteres,
    // levava ~10 s (backtracking exponencial). Aqui são 100 mil caracteres.
    const entrada = `-- @consulta x\nSELECT 1;${'--'.repeat(50000)}x\nSELECT`;
    const inicio = process.hrtime.bigint();
    assert.throws(() => separarConsultas(entrada));
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    assert.ok(ms < 200, `levou ${ms.toFixed(1)} ms`);
  });

  test('as três consultas do arquivo recebem o período em $1 e $2', () => {
    assert.deepEqual(Object.keys(CONSULTAS_BD2).sort(), ['mttr-acima-media', 'pareto-causas', 'top-pecas']);
    for (const [nome, sql] of Object.entries(CONSULTAS_BD2)) {
      assert.ok(sql.includes('$1') && sql.includes('$2'), nome);
      assert.ok(!sql.includes(String.raw`\bind`), `${nome}: linha do psql não pode ir para a API`);
    }
  });

  test('MTTR acima da média: só E1 (3h > média 2h); devolve o período usado', async () => {
    const res = await get('/api/kpis/mttr-acima-media', 'SUPERVISOR');
    assert.equal(res.status, 200);
    const dias = (new Date(res.body.fim) - new Date(res.body.inicio)) / 86400000;
    assert.equal(dias, 90, 'padrão: últimos 90 dias');
    assert.deepEqual(res.body.linhas.map((r) => [r.tag, r.mttr_h, r.mttr_medio_h]), [[e1.tag, 3, 2]]);
  });

  test('MTTR acima da média respeita o período: só a falha de E3 (3 dias atrás) => ninguém acima', async () => {
    // em 4 dias só cabe a falha de E3 (aberta há 72 h): um único MTTR é igual à média
    const res = await get(`/api/kpis/mttr-acima-media?inicio=${diasAtras(4)}&fim=${diasAtras(0)}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.linhas, []);
  });

  test('top peças: padrão de 90 dias inclui a saída de 40 dias atrás', async () => {
    const res = await get('/api/kpis/top-pecas');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.linhas.map((r) => [r.codigo, r.qtd_consumida, r.custo_estimado]), [
      [p2.codigo, 102, 408],
      [p1.codigo, 5, 50],
    ]);
  });

  test('top peças em 30 dias: p1 (5) antes de p2 (2); a saída de 40 dias atrás fica de fora', async () => {
    const res = await get(`/api/kpis/top-pecas?inicio=${diasAtras(30)}&fim=${diasAtras(0)}`);
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.inicio, res.body.fim], [diasAtras(30), diasAtras(0)]);
    assert.deepEqual(res.body.linhas.map((r) => [r.codigo, r.qtd_consumida, r.custo_estimado]), [
      [p1.codigo, 5, 50],
      [p2.codigo, 2, 8],
    ]);
  });

  test('Pareto de causas: A 66,67% e B acumulando 100%', async () => {
    const res = await get('/api/kpis/pareto-causas');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.linhas.map((r) => [r.causa, r.qtd, r.pct, r.pct_acumulado]), [
      ['Causa A', 2, 66.67, 66.67],
      ['Causa B', 1, 33.33, 100],
    ]);
  });

  test('Pareto respeita o período: em 4 dias só a falha de E3 (Causa B, 100%)', async () => {
    const res = await get(`/api/kpis/pareto-causas?inicio=${diasAtras(4)}&fim=${diasAtras(0)}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.linhas.map((r) => [r.causa, r.qtd, r.pct_acumulado]), [['Causa B', 1, 100]]);
  });

  test('consultas BD2 fora do período das OS: listas vazias', async () => {
    for (const rota of ['mttr-acima-media', 'top-pecas', 'pareto-causas']) {
      const res = await get(`/api/kpis/${rota}?inicio=2020-01-01&fim=2020-01-31`);
      assert.equal(res.status, 200, rota);
      assert.deepEqual(res.body, { inicio: '2020-01-01', fim: '2020-01-31', linhas: [] }, rota);
    }
  });

  test('consultas BD2 com datas inválidas: 400', async () => {
    for (const rota of ['mttr-acima-media', 'top-pecas', 'pareto-causas']) {
      for (const q of ['inicio=2026-13-01', 'fim=ontem', 'inicio=2026-05-10&fim=2026-05-01']) {
        assert.equal((await get(`/api/kpis/${rota}?${q}`)).status, 400, `${rota} ${q}`);
      }
    }
  });

  test('todas as rotas de KPI exigem login (401) e aceitam qualquer perfil', async () => {
    const rotas = ['/api/kpis', '/api/kpis/resumo', '/api/kpis/mttr-acima-media', '/api/kpis/top-pecas', '/api/kpis/pareto-causas'];
    for (const rota of rotas) {
      assert.equal((await request(app).get(rota)).status, 401, rota);
      for (const chave of ['OPERADOR', 'TECNICO', 'SUPERVISOR']) {
        assert.equal((await get(rota, chave)).status, 200, `${rota} ${chave}`);
      }
    }
  });
});
