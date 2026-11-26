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
// URL do DONO das tabelas (migrações, seed e preparação dos testes). A API não a usa:
// ela conecta só com o papel maintos_app, que não ignora a Row-Level Security.
const databaseUrlAdmin = (emTeste ? process.env.DATABASE_URL_TEST_ADMIN : process.env.DATABASE_URL_ADMIN) || null;
if (emTeste && databaseUrlAdmin && databaseUrlAdmin === process.env.DATABASE_URL_ADMIN) {
  throw new Error('DATABASE_URL_TEST_ADMIN não pode ser igual a DATABASE_URL_ADMIN (banco de desenvolvimento).');
}

// Pedidos de acesso (landing) por IP a cada hora. Padrão 5: barra robôs e abuso.
export function lerLimiteSolicitacoes(valor) {
  if (valor === undefined || valor === '') return 5;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 10000) {
    throw new Error('SOLICITACAO_RATE_LIMIT_MAX deve ser um inteiro entre 1 e 10000.');
  }
  return n;
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

// Número de proxies entre o cliente e a API (trust proxy do Express). Padrão 1: no Render,
// o balanceador de carga; no desenvolvimento local não há proxy, e o valor não atrapalha.
export function lerTrustProxy(valor) {
  if (valor === undefined || valor === '') return 1;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > 5) {
    throw new Error('TRUST_PROXY deve ser um inteiro entre 0 e 5 (número de proxies na frente da API).');
  }
  return n;
}

export const config = Object.freeze({
  emTeste,
  databaseUrl,
  databaseUrlAdmin,
  jwtSecret,
  jwtExpiresIn: '8h',
  port: Number(process.env.PORT) || 3000,
  loginRateLimitMax: lerLimiteLogin(process.env.LOGIN_RATE_LIMIT_MAX),
  solicitacaoRateLimitMax: lerLimiteSolicitacoes(process.env.SOLICITACAO_RATE_LIMIT_MAX),
  trustProxy: lerTrustProxy(process.env.TRUST_PROXY),
});
