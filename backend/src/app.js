// Monta o app Express (sem dar listen), para poder ser usado pelo server.js e pelos testes.
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import osRoutes from './routes/os.js';
import equipamentosRoutes from './routes/equipamentos.js';
import { pecasRouter, alertasRouter } from './routes/pecas.js';
import kpisRoutes from './routes/kpis.js';
import usuariosRoutes from './routes/usuarios.js';
import plataformaRoutes from './routes/plataforma.js';
import { criarRotasSolicitacoes } from './routes/solicitacoes.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';
import { config } from './config.js';

const PASTA_FRONT = fileURLToPath(new URL('../../frontend/', import.meta.url));
// arquivos de desenvolvimento do front que não devem ser servidos
const INTERNOS_DO_FRONT = ['/node_modules', '/scripts', '/package.json', '/package-lock.json'];
const ehApi = (req) => req.path === '/api' || req.path.startsWith('/api/');
const paginaNaoEncontrada = (_req, res) => res.status(404).sendFile('404.html', { root: PASTA_FRONT });

// Monta o app. "producao" só muda a CSP (upgrade-insecure-requests); "trustProxy" é o número
// de proxies na frente da API; "limiteSolicitacoes" é o máximo de pedidos de acesso por IP
// por hora. Os testes usam os parâmetros para montar o app de produção e testar o limite.
export function criarApp({
  producao = process.env.NODE_ENV === 'production',
  trustProxy = config.trustProxy,
  limiteSolicitacoes = config.solicitacaoRateLimitMax,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  // No Render, a requisição passa pelo balanceador (que termina o HTTPS) antes de chegar ao
  // Node. Com trust proxy = 1 o Express usa como IP do cliente o último endereço do cabeçalho
  // X-Forwarded-For, que é o que o balanceador acrescenta, e o rate limit conta por cliente.
  // Não usar "true": o Express pegaria o primeiro endereço do cabeçalho, que o próprio cliente
  // pode forjar. O valor vem de TRUST_PROXY (padrão 1).
  app.set('trust proxy', trustProxy);

  // Cabeçalhos de segurança HTTP. A Content-Security-Policy é escrita à mão, sem os padrões
  // do helmet (que liberam style-src 'unsafe-inline'): o navegador só executa scripts e
  // estilos vindos de arquivos do próprio site. Nada de <script> inline, atributos onclick
  // ou style="" no HTML; o Chart.js também é servido localmente (sem CDN). O helmet também
  // manda o Strict-Transport-Security (HSTS), que o navegador respeita em HTTPS.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        // só em produção (HTTPS): em desenvolvimento quebraria o http://localhost
        ...(producao ? { upgradeInsecureRequests: [] } : {}),
      },
    },
  }));
  app.use(express.json({ limit: '100kb' }));         // corpo JSON com tamanho limitado

  // O próprio Express serve o front (pasta frontend/), em desenvolvimento e em produção
  // (no Render não há NGINX). API e front ficam na mesma origem, sem CORS.
  app.use((req, res, next) => (
    INTERNOS_DO_FRONT.some((p) => req.path === p || req.path.startsWith(`${p}/`)) ? paginaNaoEncontrada(req, res) : next()
  ));
  app.use(express.static(PASTA_FRONT, { index: 'index.html' }));
  // qualquer outra rota fora de /api que não existe: página 404 amigável (o JSON fica só para /api)
  app.use((req, res, next) => (ehApi(req) ? next() : paginaNaoEncontrada(req, res)));

  // Health check do Render: antes do rate limit, para as verificações periódicas não
  // consumirem a cota. Não consulta o banco: diz só se o processo Node está de pé.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // Limite geral por IP para toda a API
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { erro: { codigo: 'MUITAS_REQUISICOES', mensagem: 'Muitas requisições. Tente mais tarde.' } },
  }));

  app.use('/api/auth', authRoutes);
  app.use('/api/os', osRoutes);
  app.use('/api/equipamentos', equipamentosRoutes);
  app.use('/api/pecas', pecasRouter);
  app.use('/api/alertas', alertasRouter);
  app.use('/api/kpis', kpisRoutes);
  app.use('/api/usuarios', usuariosRoutes);
  app.use('/api/solicitacoes', criarRotasSolicitacoes({ limite: limiteSolicitacoes }));
  app.use('/api/plataforma', plataformaRoutes);

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}

export const app = criarApp();
