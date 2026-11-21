// Monta o app Express (sem dar listen), para poder ser usado pelo server.js e pelos testes.
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import osRoutes from './routes/os.js';
import equipamentosRoutes from './routes/equipamentos.js';
import { pecasRouter, alertasRouter } from './routes/pecas.js';
import kpisRoutes from './routes/kpis.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';

export const app = express();

app.disable('x-powered-by');
// Em produção a API fica atrás do NGINX (1 proxy). Com isso o Express usa o IP real do
// cliente (cabeçalho X-Forwarded-For) e o rate limit conta por cliente, não pelo NGINX.
// "1" = confia só no proxy imediatamente à frente; não aceita X-Forwarded-For forjado em cadeia.
app.set('trust proxy', 1);
app.use(helmet());                                 // cabeçalhos de segurança HTTP
app.use(express.json({ limit: '100kb' }));         // corpo JSON com tamanho limitado

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
