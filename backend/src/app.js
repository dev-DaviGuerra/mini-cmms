// Monta o app Express (sem dar listen), para poder ser usado pelo server.js e pelos testes.
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';

export const app = express();

app.disable('x-powered-by');
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

app.use(rotaNaoEncontrada);
app.use(tratarErros);
