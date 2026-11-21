// Rotas de autenticação: /api/auth
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { autenticar } from '../middlewares/auth.js';
import { ErroValidacao } from '../errors.js';
import { criarValidador } from '../validacao.js';
import { config } from '../config.js';
import * as authService from '../services/authService.js';

const router = Router();

// Limite mais rígido no login para dificultar ataque de força bruta em senhas.
// LOGIN_RATE_LIMIT_MAX no .env (padrão 10 tentativas por IP a cada 15 minutos).
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.loginRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas de login. Tente em 15 minutos.' },
  },
});

function validarLogin(body) {
  const { email, senha } = body ?? {};
  const problemas = [];
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 150) {
    problemas.push('email deve ser um e-mail válido');
  }
  if (typeof senha !== 'string' || senha.length === 0 || senha.length > 72) {
    problemas.push('senha é obrigatória (até 72 caracteres)'); // 72 = limite do bcrypt
  }
  if (problemas.length) throw new ErroValidacao('Dados de login inválidos', problemas);
  return { email, senha };
}

// POST /api/auth/login  { email, senha }  ->  { token, expiraEm, usuario }
router.post('/login', limiteLogin, async (req, res) => {
  const { email, senha } = validarLogin(req.body);
  res.json(await authService.login(email, senha));
});

// GET /api/auth/me  ->  dados do usuário do token (útil para o front validar a sessão)
router.get('/me', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

// Troca de senha também é limitada: impede adivinhar a senha atual por tentativa e erro
// a partir de uma sessão aberta. Contador separado do login.
const limiteSenha = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.loginRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas de troca de senha. Tente em 15 minutos.' },
  },
});

// POST /api/auth/senha  { senhaAtual, novaSenha }  ->  204. Qualquer usuário logado.
router.post('/senha', limiteSenha, autenticar, async (req, res) => {
  const v = criarValidador();
  const { senhaAtual, novaSenha } = req.body ?? {};
  if (typeof senhaAtual !== 'string' || !senhaAtual || senhaAtual.length > 72) v.erro('senhaAtual é obrigatória');
  v.senha(novaSenha, 'novaSenha');
  v.verificar('Dados para troca de senha inválidos');

  await authService.trocarSenha(req.usuario.id, senhaAtual, novaSenha);
  res.status(204).end();
});

export default router;
