// O Express serve o frontend/ (em desenvolvimento e em produção, no Render), com uma CSP sem
// 'unsafe-inline'. O app de produção é montado com criarApp({ producao: true }).
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import request from 'supertest';
import { app, criarApp } from '../src/app.js';
import { lerLimiteLogin, lerTrustProxy } from '../src/config.js';
import { encerrar } from './helpers.js';

after(encerrar);

const PASTA_FRONT = new URL('../../frontend/', import.meta.url);

describe('front estático e CSP', () => {
  test('/ entrega a landing page pública: seções, botões e rodapé, sem script e sem formulário', async () => {
    const pagina = await request(app).get('/');
    assert.equal(pagina.status, 200);
    assert.match(pagina.headers['content-type'], /text\/html/);
    const html = pagina.text;
    assert.match(html, /<title>MaintOS · Gestão de manutenção industrial \(CMMS\)<\/title>/);
    assert.match(html, /<h1 id="titulo-hero">Manutenção sob controle\.<\/h1>/);
    for (const secao of ['o-que-faz', 'como-funciona', 'para-sua-empresa']) {
      assert.match(html, new RegExp(`<section id="${secao}"[^>]*aria-labelledby="titulo-${secao}"`), secao);
    }
    assert.match(html, /MTTR/);
    assert.match(html, /MTBF/);
    assert.match(html, /sua própria instalação/);
    // Entrar => login.html; nenhum link para a raiz como se fosse o login
    assert.ok((html.match(/href="\/login\.html"/g) ?? []).length >= 2, 'botões Entrar');
    // Solicitar demonstração: mailto com assunto e corpo, sem formulário nem gravação de dados
    const mailtos = [...html.matchAll(/href="(mailto:[^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
    assert.ok(mailtos.length >= 1, 'botão Solicitar demonstração');
    for (const link of mailtos) {
      const url = new URL(link);
      assert.equal(url.pathname, 'davimguerra@gmail.com');
      assert.equal(url.searchParams.get('subject'), 'Demonstração do MaintOS');
      assert.match(url.searchParams.get('body'), /Gostaria de agendar uma demonstração do MaintOS\.\r\n/);
    }
    assert.doesNotMatch(html, /<form[\s>]/i, 'sem formulário');
    assert.doesNotMatch(html, /<script[\s>]/i, 'página estática, sem JavaScript');
    // acessibilidade: idioma, link para pular ao conteúdo, landmarks e um único h1
    assert.match(html, /<html lang="pt-BR">/);
    assert.match(html, /<a class="pular-conteudo" href="#conteudo">/);
    assert.match(html, /<main id="conteudo">/);
    assert.match(html, /<nav [^>]*aria-label=/);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    // rodapé
    assert.match(html, /Projeto acadêmico · dados fictícios/);
    assert.match(html, /<a href="https:\/\/github\.com\/dev-DaviGuerra\/mini-cmms">/);

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
      // links de navegação <a href> não carregam nada; o único externo permitido é o GitHub
      const original = readFileSync(arquivo, 'utf8');
      for (const [, destino] of original.matchAll(/<a\s[^>]*href="((?:https?:)?\/\/[^"]*)"/gi)) {
        assert.match(destino, /^https:\/\/github\.com\/dev-DaviGuerra\/mini-cmms$/, `${arquivo.pathname}: link externo ${destino}`);
      }
      const texto = original.replaceAll(/<a\s[^>]*>/gi, '<a>');
      assert.doesNotMatch(texto, /(src|href|url)\s*[=(]\s*["']?(https?:)?\/\//i, `${arquivo.pathname}: URL externa`);
      assert.doesNotMatch(texto, /@import/i, `${arquivo.pathname}: @import`);
    }
  });

  test('login em /login.html: marca MaintOS com "OS" em destaque e link de volta para a landing', async () => {
    const pagina = await request(app).get('/login.html');
    assert.equal(pagina.status, 200);
    assert.match(pagina.text, /<title>Entrar · MaintOS<\/title>/);
    assert.match(pagina.text, /Maint<span class="marca-os">OS<\/span>/, '"OS" destacado por classe, sem estilo inline');
    assert.match(pagina.text, /Gestão de manutenção industrial \(CMMS\)/);
    assert.match(pagina.text, /<form id="form-login"/);
    assert.match(pagina.text, /<a href="\/">/);
  });

  test('401, "Sair" e 404 levam para login.html, nunca para a raiz (landing)', async () => {
    const api = readFileSync(new URL('js/api.js', PASTA_FRONT), 'utf8');
    assert.match(api, /`login\.html\?motivo=\$\{encodeURIComponent\(motivo\)\}` : 'login\.html'/);
    for (const arquivo of readdirSync(new URL('js/', PASTA_FRONT))) {
      const codigo = readFileSync(new URL(`js/${arquivo}`, PASTA_FRONT), 'utf8');
      assert.doesNotMatch(codigo, /index\.html/, `${arquivo} não pode mandar o usuário para a landing`);
    }
    const pagina404 = (await request(app).get('/nao-existe')).text;
    assert.match(pagina404, /href="\/login\.html"/);
    assert.doesNotMatch(pagina404, /index\.html/);
  });
});

test('nome do produto: MaintOS em todos os títulos, sem "Mini-CMMS" no front', () => {
  for (const arquivo of readdirSync(PASTA_FRONT).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(new URL(arquivo, PASTA_FRONT), 'utf8');
    assert.match(html, /<title>[^<]*MaintOS[^<]*<\/title>/, arquivo);
  }
  const textos = [
    ...readdirSync(PASTA_FRONT).filter((f) => f.endsWith('.html')).map((f) => new URL(f, PASTA_FRONT)),
    ...readdirSync(new URL('js/', PASTA_FRONT)).map((f) => new URL(`js/${f}`, PASTA_FRONT)),
    new URL('img/logo.svg', PASTA_FRONT),
  ];
  // sensível a maiúsculas: o nome técnico "mini-cmms" (URL do repositório) continua permitido
  for (const arquivo of textos) assert.doesNotMatch(readFileSync(arquivo, 'utf8'), /Mini-CMMS/, arquivo.pathname);
});

describe('produção (Render: sem NGINX, atrás do balanceador com HTTPS)', () => {
  const prod = criarApp({ producao: true, trustProxy: 1 });

  test('o Express serve o front também em produção, com a 404 e o bloqueio dos arquivos internos', async () => {
    const pagina = await request(prod).get('/');
    assert.equal(pagina.status, 200);
    assert.match(pagina.text, /MaintOS/);
    assert.equal((await request(prod).get('/dashboard.html')).status, 200);
    for (const rota of ['/package.json', '/scripts/copiar-vendor.js', '/node_modules/chart.js/package.json']) {
      const res = await request(prod).get(rota);
      assert.equal(res.status, 404, rota);
      assert.match(res.text, /Página não encontrada/, rota);
    }
    const inexistente = await request(prod).get('/nao-existe');
    assert.equal(inexistente.status, 404);
    assert.match(inexistente.headers['content-type'], /text\/html/);
    assert.deepEqual((await request(prod).get('/api/health')).body, { status: 'ok' });
  });

  test('cabeçalhos de segurança: CSP com upgrade-insecure-requests, HSTS, nosniff, sem X-Powered-By', async () => {
    const res = await request(prod).get('/').set('X-Forwarded-Proto', 'https');
    assert.match(res.headers['content-security-policy'], /upgrade-insecure-requests/);
    assert.doesNotMatch(res.headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
    assert.match(res.headers['strict-transport-security'], /max-age=\d+/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['x-powered-by'], undefined);
    // em desenvolvimento (http://localhost) o upgrade quebraria a página: fica desligado
    assert.doesNotMatch((await request(app).get('/')).headers['content-security-policy'], /upgrade-insecure-requests/);
  });

  test('rate limit por IP real: conta pelo último X-Forwarded-For (o do balanceador), não pelo forjado', async () => {
    const limiteDe = async (xff) => {
      const res = await request(prod).get('/api/nao-existe').set('X-Forwarded-For', xff);
      return Number(/remaining=(\d+)/.exec(res.headers.ratelimit)[1]);
    };
    const a1 = await limiteDe('203.0.113.10');
    const a2 = await limiteDe('203.0.113.10');
    assert.equal(a2, a1 - 1, 'mesmo cliente: mesmo contador');
    assert.equal(await limiteDe('198.51.100.20'), 299, 'outro cliente: contador próprio');
    // o cliente forja um IP no começo do cabeçalho; o balanceador acrescenta o IP real no fim
    assert.equal(await limiteDe('1.2.3.4, 203.0.113.10'), a1 - 2, 'IP forjado não zera o contador');
  });

  test('/api/health fica fora do rate limit (health check do Render)', async () => {
    const res = await request(prod).get('/api/health');
    assert.equal(res.headers.ratelimit, undefined);
  });
});

describe('TRUST_PROXY', () => {
  test('padrão 1; aceita inteiro de 0 a 5; recusa valor inválido', () => {
    assert.equal(lerTrustProxy(undefined), 1);
    assert.equal(lerTrustProxy(''), 1);
    assert.equal(lerTrustProxy('2'), 2);
    assert.equal(lerTrustProxy('0'), 0);
    for (const ruim of ['-1', 'true', '1.5', '6']) {
      assert.throws(() => lerTrustProxy(ruim), /TRUST_PROXY/, ruim);
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
