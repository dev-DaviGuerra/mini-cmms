// Pool de conexões do PostgreSQL, compartilhado por toda a API.
// Sempre use queries parametrizadas ($1, $2, ...), nunca concatenação de strings.
import pg from 'pg';
import { config } from './config.js';

const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '::1'];

// Banco remoto (Neon, Azure...) => SSL obrigatório com verificação do certificado.
// Banco local => sem SSL. Os parâmetros sslmode/channel_binding da URL são do libpq (psql);
// removemos para o driver pg seguir só a configuração explícita abaixo.
export function configConexao(url) {
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  u.searchParams.delete('channel_binding');
  const local = HOSTS_LOCAIS.includes(u.hostname.replace(/^\[|\]$/g, ''));
  return { connectionString: u.toString(), ssl: local ? false : { rejectUnauthorized: true } };
}

export const pool = new pg.Pool({ ...configConexao(config.databaseUrl), max: 10 });

export function query(texto, parametros) {
  return pool.query(texto, parametros);
}
