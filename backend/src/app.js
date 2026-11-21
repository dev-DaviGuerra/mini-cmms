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
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';

const emProducao = process.env.NODE_ENV === 'production';
const PASTA_FRONT = fileURLToPath(new URL('../../frontend/', import.meta.url));

export const app = express();

app.disable('x-powered-by');
// Em produção a API fica atrás do NGINX (1 proxy). Com isso o Express usa o IP real do
// cliente (cabeçalho X-Forwarded-For) e o rate limit conta por cliente, não pelo NGINX.
// "1" = confia só no proxy imediatamente à frente; não aceita X-Forwarded-For forjado em cadeia.
app.set('trust proxy', 1);

// Cabeçalhos de segurança HTTP. A Content-Security-Policy é escrita à mão, sem os padrões
// do helmet (que liberam style-src 'unsafe-inline'): o navegador só executa scripts e
// estilos vindos de arquivos do próprio site. Nada de <script> inline, atributos onclick
// ou style="" no HTML; o Chart.js também é servido localmente (sem CDN).
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
      ...(emProducao ? { upgradeInsecureRequests: [] } : {}),
    },
  },
}));
app.use(express.json({ limit: '100kb' }));         // corpo JSON com tamanho limitado

// Em desenvolvimento o próprio Express serve o front (pasta frontend/).
// No deploy quem serve os arquivos estáticos é o NGINX.
if (!emProducao) {
  app.use(express.static(PASTA_FRONT, { index: 'index.html' }));
}

// Limite geral por IP para toda a API
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: { codigo: 'MUITAS_REQUISICOES', mensagem: 'Muitas requisições. Tente mais tarde.' } },
}));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/os', osRoutes);
app.use('/api/equipamentos', equipamentosRoutes);
app.use('/api/pecas', pecasRouter);
app.use('/api/alertas', alertasRouter);
app.use('/api/kpis', kpisRoutes);

app.use(rotaNaoEncontrada);
app.use(tratarErros);
