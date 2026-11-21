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

// Executa fn(client) numa transação, numa única conexão do pool.
// Antes de tudo grava o usuário em app.usuario_id, que a trigger trg_auditoria_os lê.
// set_config(..., true) = vale só até o fim desta transação (equivale a SET LOCAL, mas
// aceita parâmetro $1, o que SET LOCAL não aceita).
// Qualquer erro dentro de fn => ROLLBACK e o erro é repassado; nada fica gravado.
export async function transacao(usuarioId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.usuario_id', $1, true)", [String(usuarioId)]);
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}
