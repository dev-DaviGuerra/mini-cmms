// Cadastro público (POST /api/solicitacoes) e painel da plataforma (#41).
// Fluxo completo: alguém pede acesso na landing -> o PLATAFORMA aprova -> nasce a empresa e
// o primeiro SUPERVISOR com senha temporária (mostrada uma vez) -> troca obrigatória no
// primeiro login. O PLATAFORMA não vê nenhum dado operacional das empresas.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { criarApp } from '../src/app.js';
import { gerarSenhaTemporaria } from '../src/services/plataformaService.js';
import {
  pool, criarUsuarios, criarEquipamento, encerrar, login, registrarEmpresa, SENHA_TESTE,
} from './helpers.js';

// limite alto: este arquivo faz muitos pedidos; o limite em si é testado com outro app
const app = criarApp({ limiteSolicitacoes: 1000 });
const sufixo = `${process.pid}-${Date.now()}`;
const emailDe = (nome) => `teste-sol-${nome}-${sufixo}@exemplo.com`;
let admin;
let tokenAdmin;
let usuarios;
const tokens = {};

const comoAdmin = () => ({ Authorization: `Bearer ${tokenAdmin}` });
const pedido = (extra = {}) => ({
  empresa: 'Fundição Teste', responsavel: 'Rita Responsável', email: emailDe('padrao'), cidade: 'Joinville',
  uf: 'sc', equipamentos: 40, consentimento: true, ...extra,
});
const pedir = (corpo, aplicacao = app) => request(aplicacao).post('/api/solicitacoes').send(corpo);
const solicitacoesDe = async (email) => (await pool.query(
  'SELECT id, status, uf, consentimento_em, termo_versao, empresa_id FROM solicitacoes_acesso WHERE email = $1', [email])).rows;

before(async () => {
  const hash = await bcrypt.hash(SENHA_TESTE, 4);
  admin = (await pool.query(
    "INSERT INTO usuarios_plataforma (nome, email, senha_hash) VALUES ('Admin Teste', $1, $2) RETURNING id, email",
    [`teste-plataforma-${sufixo}@maintos.local`, hash])).rows[0];
  tokenAdmin = await login(app, request, admin);
  usuarios = await criarUsuarios();
  tokens.SUPERVISOR = await login(app, request, usuarios.SUPERVISOR);
  await criarEquipamento();
});

after(async () => {
  await pool.query("DELETE FROM solicitacoes_acesso WHERE email LIKE 'teste-sol-%' AND email LIKE $1", [`%${sufixo}%`]);
  await pool.query('DELETE FROM usuarios_plataforma WHERE id = $1', [admin.id]);
  await encerrar();
});

describe('cadastro público (POST /api/solicitacoes)', () => {
  test('pedido válido: 202 e grava PENDENTE, com data e versão do consentimento', async () => {
    const res = await pedir(pedido({ email: emailDe('valido') }));
    assert.equal(res.status, 202);
    assert.match(res.body.mensagem, /Recebemos sua solicitação/);
    const [s] = await solicitacoesDe(emailDe('valido'));
    assert.equal(s.status, 'PENDENTE');
    assert.equal(s.uf, 'SC', 'UF normalizada');
    assert.ok(s.consentimento_em instanceof Date);
    assert.equal(s.termo_versao, '2026-11');
  });

  test('sem consentimento LGPD: 400 e nada gravado', async () => {
    for (const consentimento of [false, undefined, 'sim']) {
      const res = await pedir(pedido({ email: emailDe('sem-consentimento'), consentimento }));
      assert.equal(res.status, 400);
      assert.ok(res.body.erro.detalhes.some((d) => d.includes('consentimento')));
    }
    assert.equal((await solicitacoesDe(emailDe('sem-consentimento'))).length, 0);
  });

  test('validação no servidor: e-mail, UF, nº de equipamentos e tamanhos', async () => {
    const res = await pedir({ empresa: 'x', responsavel: '', email: 'nao-e-email', cidade: 'S', uf: 'XX', equipamentos: 0, consentimento: true });
    assert.equal(res.status, 400);
    for (const campo of ['empresa', 'responsavel', 'email', 'cidade', 'uf', 'equipamentos']) {
      assert.ok(res.body.erro.detalhes.some((d) => d.startsWith(campo)), campo);
    }
  });

  test('honeypot preenchido (robô): mesma resposta 202, mas nada é gravado', async () => {
    const res = await pedir(pedido({ email: emailDe('robo'), site: 'http://spam.example' }));
    assert.equal(res.status, 202);
    assert.equal((await solicitacoesDe(emailDe('robo'))).length, 0);
  });

  test('segundo pedido PENDENTE com o mesmo e-mail: mesma resposta, sem duplicar', async () => {
    assert.equal((await pedir(pedido({ email: emailDe('repetido') }))).status, 202);
    assert.equal((await pedir(pedido({ email: emailDe('repetido').toUpperCase() }))).status, 202);
    assert.equal((await solicitacoesDe(emailDe('repetido'))).length, 1);
  });

  test('rate limit por IP: passou do limite => 429', async () => {
    const limitado = criarApp({ limiteSolicitacoes: 2 });
    for (let i = 0; i < 2; i += 1) assert.equal((await pedir({}, limitado)).status, 400);
    const res = await pedir(pedido({ email: emailDe('limite') }), limitado);
    assert.equal(res.status, 429);
    assert.equal(res.body.erro.codigo, 'MUITAS_SOLICITACOES');
  });
});

describe('painel da plataforma', () => {
  test('PLATAFORMA não acessa as rotas das empresas (403)', async () => {
    for (const rota of ['/api/os', '/api/equipamentos', '/api/pecas', '/api/kpis/resumo', '/api/usuarios']) {
      const res = await request(app).get(rota).set(comoAdmin());
      assert.equal(res.status, 403, rota);
    }
  });

  test('usuário de empresa não acessa o painel da plataforma (403)', async () => {
    for (const rota of ['/api/plataforma/solicitacoes', '/api/plataforma/empresas']) {
      const res = await request(app).get(rota).set('Authorization', `Bearer ${tokens.SUPERVISOR}`);
      assert.equal(res.status, 403, rota);
    }
  });

  test('lista solicitações por status e empresas (só dados cadastrais)', async () => {
    await pedir(pedido({ email: emailDe('lista') }));
    const res = await request(app).get('/api/plataforma/solicitacoes').set(comoAdmin());
    assert.equal(res.status, 200);
    assert.ok(res.body.some((s) => s.email === emailDe('lista') && s.status === 'PENDENTE'));
    assert.equal((await request(app).get('/api/plataforma/solicitacoes?status=XPTO').set(comoAdmin())).status, 400);

    const empresas = await request(app).get('/api/plataforma/empresas').set(comoAdmin());
    assert.equal(empresas.status, 200);
    assert.deepEqual(Object.keys(empresas.body[0]).sort(), ['ativa', 'cidade', 'criada_em', 'id', 'nome', 'uf']);
  });

  test('aprovar: cria empresa + SUPERVISOR, senha temporária só na resposta, troca obrigatória', async () => {
    await pedir(pedido({ email: emailDe('aprovar'), empresa: 'Usinagem Aprovada' }));
    const [s] = await solicitacoesDe(emailDe('aprovar'));

    const res = await request(app).post(`/api/plataforma/solicitacoes/${s.id}/aprovar`).set(comoAdmin());
    assert.equal(res.status, 201);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.body.senhaTemporaria, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(res.body.empresa.nome, 'Usinagem Aprovada');
    assert.equal(res.body.supervisor.email, emailDe('aprovar'));
    registrarEmpresa(res.body.empresa.id);

    // no banco: só o hash, troca obrigatória ligada, solicitação APROVADA ligada à empresa
    const u = (await pool.query('SELECT senha_hash, trocar_senha, perfil, empresa_id FROM usuarios WHERE id = $1',
      [res.body.supervisor.id])).rows[0];
    assert.notEqual(u.senha_hash, res.body.senhaTemporaria);
    assert.ok(await bcrypt.compare(res.body.senhaTemporaria, u.senha_hash));
    assert.deepEqual([u.trocar_senha, u.perfil, u.empresa_id], [true, 'SUPERVISOR', res.body.empresa.id]);
    assert.deepEqual((await solicitacoesDe(emailDe('aprovar')))[0].empresa_id, res.body.empresa.id);

    // a senha não aparece de novo em lugar nenhum
    const aprovadas = await request(app).get('/api/plataforma/solicitacoes?status=APROVADA').set(comoAdmin());
    assert.doesNotMatch(JSON.stringify(aprovadas.body), new RegExp(res.body.senhaTemporaria));
    const deNovo = await request(app).post(`/api/plataforma/solicitacoes/${s.id}/aprovar`).set(comoAdmin());
    assert.equal(deNovo.status, 409);
    assert.equal(deNovo.body.erro.codigo, 'JA_DECIDIDA');

    // primeiro login: só /me e /senha até trocar
    const entrada = await request(app).post('/api/auth/login').send({ email: emailDe('aprovar'), senha: res.body.senhaTemporaria });
    assert.equal(entrada.status, 200);
    assert.equal(entrada.body.usuario.trocarSenha, true);
    const como = { Authorization: `Bearer ${entrada.body.token}` };
    const bloqueada = await request(app).get('/api/os').set(como);
    assert.equal(bloqueada.status, 403);
    assert.equal(bloqueada.body.erro.codigo, 'TROCA_SENHA_OBRIGATORIA');
    assert.equal((await request(app).get('/api/auth/me').set(como)).status, 200);
    const troca = await request(app).post('/api/auth/senha').set(como)
      .send({ senhaAtual: res.body.senhaTemporaria, novaSenha: 'NovaSenha2026forte' });
    assert.equal(troca.status, 204);

    // depois da troca: acesso liberado, e a empresa nova começa vazia (não vê as outras)
    const os = await request(app).get('/api/os').set(como);
    assert.equal(os.status, 200);
    assert.equal(os.body.paginacao.total, 0);
    const equipamentos = await request(app).get('/api/equipamentos').set(como);
    assert.deepEqual(equipamentos.body, []);
  });

  test('aprovar com e-mail já usado na plataforma: 409 EMAIL_EM_USO, nada criado', async () => {
    await pedir(pedido({ email: usuarios.OPERADOR.email }));
    const [s] = (await pool.query("SELECT id FROM solicitacoes_acesso WHERE email = $1 AND status = 'PENDENTE'",
      [usuarios.OPERADOR.email])).rows;
    const res = await request(app).post(`/api/plataforma/solicitacoes/${s.id}/aprovar`).set(comoAdmin());
    assert.equal(res.status, 409);
    assert.equal(res.body.erro.codigo, 'EMAIL_EM_USO');
    assert.equal((await pool.query('SELECT status FROM solicitacoes_acesso WHERE id = $1', [s.id])).rows[0].status, 'PENDENTE');
    await pool.query('DELETE FROM solicitacoes_acesso WHERE id = $1', [s.id]);
  });

  test('recusar: 200 com motivo; de novo 409; inexistente 404', async () => {
    await pedir(pedido({ email: emailDe('recusar') }));
    const [s] = await solicitacoesDe(emailDe('recusar'));
    const res = await request(app).post(`/api/plataforma/solicitacoes/${s.id}/recusar`).set(comoAdmin())
      .send({ motivo: 'Fora do perfil atendido' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'RECUSADA');
    assert.equal(res.body.motivo_recusa, 'Fora do perfil atendido');
    assert.equal((await request(app).post(`/api/plataforma/solicitacoes/${s.id}/recusar`).set(comoAdmin())).status, 409);
    assert.equal((await request(app).post('/api/plataforma/solicitacoes/999999999/recusar').set(comoAdmin())).status, 404);
    assert.equal((await request(app).post('/api/plataforma/solicitacoes/999999999/aprovar').set(comoAdmin())).status, 404);
  });

  test('PLATAFORMA troca a própria senha', async () => {
    const res = await request(app).post('/api/auth/senha').set(comoAdmin())
      .send({ senhaAtual: SENHA_TESTE, novaSenha: 'Plataforma2026nova' });
    assert.equal(res.status, 204);
    const me = await request(app).get('/api/auth/me').set(comoAdmin());
    assert.equal(me.body.usuario.perfil, 'PLATAFORMA');
  });

  test('senha temporária: formato legível, com letra e número', () => {
    for (let i = 0; i < 50; i += 1) {
      const s = gerarSenhaTemporaria();
      assert.match(s, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      assert.match(s, /\d/);
      assert.match(s, /[A-Z]/);
    }
  });
});
