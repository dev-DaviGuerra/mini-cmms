import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../src/app.js';
import { pool, criarUsuarios, removerDados, encerrar, login, SENHA_TESTE } from './helpers.js';

let usuarios;
const tokens = {};
const criados = {}; // usuários criados pela API neste arquivo (removidos no final)
const sufixo = `${process.pid}-${Date.now()}`;
const SENHA_NOVA = 'Prensa2026hidraulica';

const como = (chave) => ({ Authorization: `Bearer ${tokens[chave]}` });
const entrar = (email, senha) => request(app).post('/api/auth/login').send({ email, senha });

// nenhuma resposta pode conter o hash bcrypt nem o nome da coluna
function semHash(res) {
  const texto = JSON.stringify(res.body ?? '');
  assert.doesNotMatch(texto, /senha_hash|\$2[aby]\$/, 'resposta não pode expor o hash da senha');
}

before(async () => {
  usuarios = await criarUsuarios();
  for (const chave of Object.keys(usuarios)) tokens[chave] = await login(app, request, usuarios[chave]);
});

after(async () => {
  await removerDados({ usuarios: { ...usuarios, ...criados } });
  await encerrar();
});

describe('GET/POST /api/usuarios (só SUPERVISOR)', () => {
  test('supervisor cadastra: 201, e-mail normalizado, ativo, sem hash; senha guardada com bcrypt', async () => {
    const res = await request(app).post('/api/usuarios').set(como('SUPERVISOR')).send({
      nome: 'Nova Técnica', email: `  NOVA-${sufixo}@CMMS.local `, perfil: 'TECNICO', senha: SENHA_NOVA,
    });
    assert.equal(res.status, 201);
    semHash(res);
    criados.nova = res.body;
    assert.equal(res.body.email, `nova-${sufixo}@cmms.local`);
    assert.equal(res.body.perfil, 'TECNICO');
    assert.equal(res.body.ativo, true);

    const { senha_hash: hash } = (await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [res.body.id])).rows[0];
    assert.match(hash, /^\$2b\$10\$/, 'bcrypt com custo 10');
    assert.ok(await bcrypt.compare(SENHA_NOVA, hash));

    const entrou = await entrar(`nova-${sufixo}@cmms.local`, SENHA_NOVA);
    assert.equal(entrou.status, 200, 'o novo usuário consegue entrar');
    semHash(entrou);
  });

  test('e-mail duplicado: 409 EMAIL_DUPLICADO (UNIQUE do banco)', async () => {
    const res = await request(app).post('/api/usuarios').set(como('SUPERVISOR')).send({
      nome: 'Repetida', email: `nova-${sufixo}@cmms.local`, perfil: 'OPERADOR', senha: SENHA_NOVA,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.erro.codigo, 'EMAIL_DUPLICADO');
  });

  test('política de senha e dados inválidos: 400 com cada problema', async () => {
    const casos = [
      ['curta1', /pelo menos 10 caracteres/],
      ['somenteletrasaqui', /pelo menos um número/],
      ['1234567890123', /pelo menos uma letra/],
      [`a1${'é'.repeat(40)}`, /no máximo 72 bytes/],
    ];
    for (const [senha, esperado] of casos) {
      const res = await request(app).post('/api/usuarios').set(como('SUPERVISOR')).send({
        nome: 'Fulano', email: `x-${sufixo}@cmms.local`, perfil: 'OPERADOR', senha,
      });
      assert.equal(res.status, 400, senha);
      assert.match(res.body.erro.detalhes.join(' | '), esperado, senha);
    }
    const ruim = await request(app).post('/api/usuarios').set(como('SUPERVISOR')).send({
      nome: 'x', email: 'sem-arroba', perfil: 'ADMIN', senha: SENHA_NOVA,
    });
    assert.equal(ruim.status, 400);
    assert.equal(ruim.body.erro.detalhes.length, 3); // nome, email, perfil
    const total = (await pool.query("SELECT COUNT(*)::int AS n FROM usuarios WHERE email LIKE 'x-%'")).rows[0].n;
    assert.equal(total, 0, 'nada foi gravado');
  });

  test('lista para o supervisor, sem hash em nenhum item', async () => {
    const res = await request(app).get('/api/usuarios').set(como('SUPERVISOR'));
    assert.equal(res.status, 200);
    semHash(res);
    const item = res.body.find((u) => u.id === criados.nova.id);
    assert.deepEqual(Object.keys(item).sort(), ['ativo', 'email', 'id', 'nome', 'perfil']);
  });

  test('operador e técnico: 403 em listar, cadastrar e ativar; sem token: 401', async () => {
    for (const chave of ['OPERADOR', 'TECNICO']) {
      assert.equal((await request(app).get('/api/usuarios').set(como(chave))).status, 403, chave);
      assert.equal((await request(app).post('/api/usuarios').set(como(chave)).send({})).status, 403, chave);
      assert.equal((await request(app).patch(`/api/usuarios/${criados.nova.id}/ativo`).set(como(chave)).send({ ativo: false })).status, 403, chave);
    }
    assert.equal((await request(app).get('/api/usuarios')).status, 401);
  });
});

describe('PATCH /api/usuarios/:id/ativo', () => {
  test('desativar: login recusado com a mensagem genérica e token antigo recusado na hora (401)', async () => {
    const email = `nova-${sufixo}@cmms.local`;
    const tokenAntigo = (await entrar(email, SENHA_NOVA)).body.token;
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenAntigo}`)).status, 200);

    const res = await request(app).patch(`/api/usuarios/${criados.nova.id}/ativo`).set(como('SUPERVISOR')).send({ ativo: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.ativo, false);
    semHash(res);

    // login: mesma resposta de senha errada (não revela que a conta existe e foi desativada)
    const inativo = await entrar(email, SENHA_NOVA);
    const senhaErrada = await entrar(email, 'senha-errada-123');
    assert.equal(inativo.status, 401);
    assert.deepEqual(inativo.body, senhaErrada.body);

    // token emitido ANTES da desativação, ainda dentro das 8h: recusado
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenAntigo}`);
    assert.equal(me.status, 401);
    const os = await request(app).get('/api/os').set('Authorization', `Bearer ${tokenAntigo}`);
    assert.equal(os.status, 401);

    // reativar: volta a funcionar
    const reativa = await request(app).patch(`/api/usuarios/${criados.nova.id}/ativo`).set(como('SUPERVISOR')).send({ ativo: true });
    assert.equal(reativa.body.ativo, true);
    assert.equal((await entrar(email, SENHA_NOVA)).status, 200);
  });

  test('supervisor não pode desativar a si mesmo: 409 e continua ativo', async () => {
    const res = await request(app).patch(`/api/usuarios/${usuarios.SUPERVISOR.id}/ativo`).set(como('SUPERVISOR')).send({ ativo: false });
    assert.equal(res.status, 409);
    assert.equal(res.body.erro.codigo, 'AUTO_DESATIVACAO');
    const { ativo } = (await pool.query('SELECT ativo FROM usuarios WHERE id = $1', [usuarios.SUPERVISOR.id])).rows[0];
    assert.equal(ativo, true);
  });

  test('ativo não booleano: 400; usuário inexistente: 404', async () => {
    for (const ativo of ['false', 0, null, undefined]) {
      const res = await request(app).patch(`/api/usuarios/${criados.nova.id}/ativo`).set(como('SUPERVISOR')).send({ ativo });
      assert.equal(res.status, 400, String(ativo));
    }
    const nf = await request(app).patch('/api/usuarios/999999/ativo').set(como('SUPERVISOR')).send({ ativo: false });
    assert.equal(nf.status, 404);
  });
});

describe('POST /api/auth/senha (troca da própria senha)', () => {
  test('senha atual errada: 400 (não 401, para não derrubar a sessão) e nada muda', async () => {
    const res = await request(app).post('/api/auth/senha').set(como('OPERADOR'))
      .send({ senhaAtual: 'nao-e-essa-1', novaSenha: 'OutraSenha2026' });
    assert.equal(res.status, 400);
    assert.equal(res.body.erro.mensagem, 'Senha atual incorreta');
    assert.equal((await entrar(usuarios.OPERADOR.email, SENHA_TESTE)).status, 200);
  });

  test('nova senha fora da política ou igual à atual: 400', async () => {
    const fraca = await request(app).post('/api/auth/senha').set(como('OPERADOR'))
      .send({ senhaAtual: SENHA_TESTE, novaSenha: 'curta' });
    assert.equal(fraca.status, 400);
    assert.match(fraca.body.erro.detalhes.join(' '), /10 caracteres/);
    const igual = await request(app).post('/api/auth/senha').set(como('OPERADOR'))
      .send({ senhaAtual: SENHA_TESTE, novaSenha: SENHA_TESTE });
    assert.equal(igual.status, 400);
    assert.match(igual.body.erro.mensagem, /diferente da atual/);
  });

  test('troca com sucesso: 204 sem corpo; a nova senha entra e a antiga não', async () => {
    const res = await request(app).post('/api/auth/senha').set(como('TECNICO'))
      .send({ senhaAtual: SENHA_TESTE, novaSenha: SENHA_NOVA });
    assert.equal(res.status, 204);
    assert.equal(res.text, '');
    assert.equal((await entrar(usuarios.TECNICO.email, SENHA_NOVA)).status, 200);
    assert.equal((await entrar(usuarios.TECNICO.email, SENHA_TESTE)).status, 401);
    const { senha_hash: hash } = (await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [usuarios.TECNICO.id])).rows[0];
    assert.match(hash, /^\$2b\$10\$/);
  });

  test('sem token: 401', async () => {
    const res = await request(app).post('/api/auth/senha').send({ senhaAtual: 'x', novaSenha: SENHA_NOVA });
    assert.equal(res.status, 401);
  });
});
