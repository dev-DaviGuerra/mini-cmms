// Carrega e valida as variáveis de ambiente uma única vez.
// Segredos vêm SÓ do .env (ou do ambiente do servidor), nunca do código.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function obrigatoria(nome) {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente ${nome} não definida (veja backend/.env.example).`);
  }
  return valor;
}

const jwtSecret = obrigatoria('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres.');
}

// Em teste (NODE_ENV=test, definido pelo "npm test") a API usa SEMPRE o banco de teste,
// porque os testes inserem e apagam dados.
const emTeste = process.env.NODE_ENV === 'test';
const databaseUrl = emTeste ? obrigatoria('DATABASE_URL_TEST') : obrigatoria('DATABASE_URL');
if (emTeste && databaseUrl === process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL_TEST não pode ser igual a DATABASE_URL (banco de desenvolvimento).');
}

// Máximo de tentativas de login por IP a cada 15 minutos. Padrão 10 (produção); em
// desenvolvimento pode ser aumentado no .env para os testes no navegador não bloquearem.
export function lerLimiteLogin(valor) {
  if (valor === undefined || valor === '') return 10;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 10000) {
    throw new Error('LOGIN_RATE_LIMIT_MAX deve ser um inteiro entre 1 e 10000.');
  }
  return n;
}

export const config = Object.freeze({
  emTeste,
  databaseUrl,
  jwtSecret,
  jwtExpiresIn: '8h',
  port: Number(process.env.PORT) || 3000,
  loginRateLimitMax: lerLimiteLogin(process.env.LOGIN_RATE_LIMIT_MAX),
});
