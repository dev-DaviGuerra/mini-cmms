// O Express serve o frontend/ em desenvolvimento, com uma CSP sem 'unsafe-inline'.
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import request from 'supertest';
import { app } from '../src/app.js';
import { lerLimiteLogin } from '../src/config.js';
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

  test('rota inexistente fora de /api: página 404.html amigável; dentro de /api: JSON', async () => {
    for (const rota of ['/nao-existe.html', '/a/b/c', '/os']) {
      const res = await request(app).get(rota);
      assert.equal(res.status, 404, rota);
      assert.match(res.headers['content-type'], /text\/html/, rota);
      assert.match(res.text, /Página não encontrada/, rota);
      assert.match(res.text, /href="\/os\.html"/, `${rota}: link para voltar`);
    }
    const api = await request(app).get('/api/nao-existe');
    assert.equal(api.status, 404);
    assert.match(api.headers['content-type'], /application\/json/);
    assert.equal(api.body.erro.codigo, 'NAO_ENCONTRADO');
    assert.deepEqual((await request(app).get('/api/health')).body, { status: 'ok' });
  });

  test('arquivos internos do front (package.json, scripts, node_modules) não são servidos', async () => {
    for (const rota of ['/package.json', '/package-lock.json', '/scripts/copiar-vendor.js', '/node_modules/@fontsource/ibm-plex-sans/LICENSE']) {
      const res = await request(app).get(rota);
      assert.equal(res.status, 404, rota);
      assert.doesNotMatch(res.text, /fontsource|copyFileSync/, `${rota} não pode vazar conteúdo`);
    }
  });

  test('fontes IBM Plex servidas localmente como font/woff2', async () => {
    for (const fonte of ['ibm-plex-sans-400', 'ibm-plex-sans-600', 'ibm-plex-mono-600']) {
      const res = await request(app).get(`/fontes/${fonte}.woff2`);
      assert.equal(res.status, 200, fonte);
      assert.match(res.headers['content-type'], /font\/woff2/, fonte);
    }
  });

  test('Chart.js servido localmente (sem CDN) e sem eval/new Function (compatível com a CSP)', async () => {
    const res = await request(app).get('/vendor/chart.umd.min.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    const codigo = readFileSync(new URL('vendor/chart.umd.min.js', PASTA_FRONT), 'utf8');
    assert.doesNotMatch(codigo, /\beval\(|new Function\(/, 'exigiria unsafe-eval na CSP');
    const dashboard = readFileSync(new URL('dashboard.html', PASTA_FRONT), 'utf8');
    assert.match(dashboard, /<script defer src="vendor\/chart\.umd\.min\.js"><\/script>/);
  });

  test('nenhum recurso externo (CDN) em HTML, CSS ou JS do front', () => {
    const arquivos = [
      ...readdirSync(PASTA_FRONT).filter((f) => f.endsWith('.html')).map((f) => new URL(f, PASTA_FRONT)),
      new URL('css/estilo.css', PASTA_FRONT),
      ...readdirSync(new URL('js/', PASTA_FRONT)).map((f) => new URL(`js/${f}`, PASTA_FRONT)),
    ];
    for (const arquivo of arquivos) {
      const texto = readFileSync(arquivo, 'utf8');
      assert.doesNotMatch(texto, /(src|href|url)\s*[=(]\s*["']?(https?:)?\/\//i, `${arquivo.pathname}: URL externa`);
      assert.doesNotMatch(texto, /@import/i, `${arquivo.pathname}: @import`);
    }
  });
});

describe('LOGIN_RATE_LIMIT_MAX', () => {
  test('padrão 10; aceita inteiro de 1 a 10000; recusa valor inválido', () => {
    assert.equal(lerLimiteLogin(undefined), 10);
    assert.equal(lerLimiteLogin(''), 10);
    assert.equal(lerLimiteLogin('100'), 100);
    for (const ruim of ['0', '-5', 'abc', '2.5', '20000']) {
      assert.throws(() => lerLimiteLogin(ruim), /LOGIN_RATE_LIMIT_MAX/, ruim);
    }
  });
});
