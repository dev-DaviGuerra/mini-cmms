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

export const config = Object.freeze({
  databaseUrl: obrigatoria('DATABASE_URL'),
  jwtSecret,
  jwtExpiresIn: '8h',
  port: Number(process.env.PORT) || 3000,
});
