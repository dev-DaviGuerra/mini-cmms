// O Express serve o frontend/ em desenvolvimento, com uma CSP sem 'unsafe-inline'.
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import request from 'supertest';
import { app } from '../src/app.js';
import { encerrar } from './helpers.js';

after(encerrar);

const PASTA_FRONT = new URL('../../frontend/', import.meta.url);

describe('front estático e CSP', () => {
  test('/ entrega a tela de login; JS e CSS com os tipos certos', async () => {
    const pagina = await request(app).get('/');
    assert.equal(pagina.status, 200);
    assert.match(pagina.headers['content-type'], /text\/html/);
    assert.match(pagina.text, /Mini-CMMS/);

    const js = await request(app).get('/js/api.js');
    assert.equal(js.status, 200);
    assert.match(js.headers['content-type'], /javascript/);

    const css = await request(app).get('/css/estilo.css');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /text\/css/);
  });

  test("CSP: só 'self' para scripts e estilos, sem 'unsafe-inline' nem 'unsafe-eval'", async () => {
    const res = await request(app).get('/os.html');
    const csp = res.headers['content-security-policy'];
    assert.ok(csp, 'cabeçalho CSP presente');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  });

  test('os HTML do front não têm script/estilo inline nem handlers on*= (senão a CSP bloquearia)', () => {
    for (const arquivo of readdirSync(PASTA_FRONT).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(new URL(arquivo, PASTA_FRONT), 'utf8');
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${arquivo}: <script> sem src`);
      assert.doesNotMatch(html, /<style[\s>]/i, `${arquivo}: <style>`);
      assert.doesNotMatch(html, /\sstyle="/i, `${arquivo}: atributo style`);
      assert.doesNotMatch(html, /\son[a-z]+="/i, `${arquivo}: atributo on*=`);
    }
  });

  test('o JS do front nunca usa innerHTML/outerHTML/insertAdjacentHTML (proteção contra XSS)', () => {
    const pasta = new URL('js/', PASTA_FRONT);
    for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith('.js'))) {
      const codigo = readFileSync(new URL(arquivo, pasta), 'utf8')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'); // ignora comentários
      assert.doesNotMatch(codigo, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, arquivo);
    }
  });

  test('rotas /api continuam respondendo JSON, e arquivo inexistente dá 404', async () => {
    const api = await request(app).get('/api/health');
    assert.deepEqual(api.body, { status: 'ok' });
    const nada = await request(app).get('/nao-existe.html');
    assert.equal(nada.status, 404);
  });
});
