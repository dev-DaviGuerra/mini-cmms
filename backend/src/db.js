// Pool de conexões do PostgreSQL, compartilhado por toda a API.
// Sempre use queries parametrizadas ($1, $2, ...), nunca concatenação de strings.
import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export function query(texto, parametros) {
  return pool.query(texto, parametros);
}
