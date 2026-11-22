import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { autenticar } from '../src/middlewares/auth.js';
import { exigirPerfil } from '../src/middlewares/perfil.js';
import { tratarErros, semQuebras } from '../src/middlewares/erros.js';
import { criarUsuarios, removerUsuarios, encerrar, SENHA_TESTE } from './helpers.js';

let usuarios;
const tokens = {};

before(async () => {
  usuarios = await criarUsuarios();
});

after(async () => {
  await removerUsuarios(usuarios);
  await encerrar();
});

describe('POST /api/auth/login', () => {
  test('login correto devolve JWT com perfil e expiração de 8h', async () => {
    for (const perfil of ['OPERADOR', 'TECNICO', 'SUPERVISOR']) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: usuarios[perfil].email, senha: SENHA_TESTE });

      assert.equal(res.status, 200);
      assert.equal(res.body.usuario.perfil, perfil);
      assert.equal(res.body.usuario.senha_hash, undefined, 'não pode vazar o hash');

      const payload = jwt.verify(res.body.token, config.jwtSecret);
      assert.equal(payload.perfil, perfil);
      assert.equal(payload.sub, String(usuarios[perfil].id));
      assert.equal(payload.exp - payload.iat, 8 * 60 * 60);
      tokens[perfil] = res.body.token;
    }
  });

  test('senha errada devolve 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: usuarios.OPERADOR.email, senha: 'senha-errada' });
    assert.equal(res.status, 401);
    assert.equal(res.body.erro.codigo, 'NAO_AUTENTICADO');
    assert.equal(res.body.token, undefined);
  });

  test('e-mail inexistente devolve 401 com a mesma mensagem da senha errada', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ninguem@cmms.local', senha: 'qualquer' });
    assert.equal(res.status, 401);
    assert.equal(res.body.erro.mensagem, 'E-mail ou senha inválidos');
  });

  test('corpo inválido devolve 400', async () => {
    const semSenha = await request(app).post('/api/auth/login').send({ email: 'a@b.c' });
    assert.equal(semSenha.status, 400);
    assert.equal(semSenha.body.erro.codigo, 'VALIDACAO');

    const jsonQuebrado = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    assert.equal(jsonQuebrado.status, 400);
  });
});

describe('autenticação e autorização', () => {
  test('sem token devolve 401', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  test('token adulterado ou expirado devolve 401', async () => {
    const adulterado = `${tokens.OPERADOR.slice(0, -2)}xx`;
    const r1 = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adulterado}`);
    assert.equal(r1.status, 401);

    const expirado = jwt.sign({ perfil: 'SUPERVISOR' }, config.jwtSecret, { subject: '1', expiresIn: -10 });
    const r2 = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expirado}`);
    assert.equal(r2.status, 401);
    assert.equal(r2.body.erro.mensagem, 'Token expirado');
  });

  test('token válido em /me devolve o usuário', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokens.TECNICO}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.usuario.perfil, 'TECNICO');
  });

  test('perfil sem permissão devolve 403', async () => {
    // rota de teste restrita a SUPERVISOR, com os middlewares reais
    const appTeste = express();
    appTeste.get('/restrita', autenticar, exigirPerfil('SUPERVISOR'), (_req, res) => res.json({ ok: true }));
    appTeste.use(tratarErros);

    for (const perfil of ['OPERADOR', 'TECNICO']) {
      const res = await request(appTeste).get('/restrita').set('Authorization', `Bearer ${tokens[perfil]}`);
      assert.equal(res.status, 403, `${perfil} não deveria acessar`);
      assert.equal(res.body.erro.codigo, 'PROIBIDO');
    }
    const ok = await request(appTeste).get('/restrita').set('Authorization', `Bearer ${tokens.SUPERVISOR}`);
    assert.equal(ok.status, 200);
  });

  test('rota inexistente devolve 404 padronizado', async () => {
    const res = await request(app).get('/api/nao-existe');
    assert.equal(res.status, 404);
    assert.equal(res.body.erro.codigo, 'NAO_ENCONTRADO');
  });
});

describe('erro inesperado (500)', () => {
  test('responde genérico e grava no log a URL sem quebras de linha (S5145)', async () => {
    const appTeste = express();
    appTeste.get('/falha', () => { throw new Error('detalhe interno'); });
    appTeste.use(tratarErros);

    const linhas = [];
    const original = console.error;
    console.error = (...args) => linhas.push(args[0]);
    let res;
    try {
      res = await request(appTeste).get('/falha?x=a%0D%0A[falso]%20LOGIN%20OK');
    } finally {
      console.error = original;
    }

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor' } });
    assert.equal(linhas.length, 1);
    assert.doesNotMatch(linhas[0], /[\r\n]/);
  });

  test('semQuebras troca CR, LF e separadores Unicode', () => {
    assert.equal(semQuebras('a\r\nb\u2028c\u2029d'), 'a__b_c_d');
    assert.equal(semQuebras(42), '42');
  });
});
