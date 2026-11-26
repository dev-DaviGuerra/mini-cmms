// Pool de conexões do PostgreSQL, compartilhado por toda a API.
// Sempre use queries parametrizadas ($1, $2, ...), nunca concatenação de strings.
//
// Multiempresa (#41): a API conecta com o papel maintos_app, que NÃO ignora a Row-Level
// Security. O que cada consulta enxerga depende do contexto da conexão:
//   app.empresa_id  empresa do usuário logado (as políticas de RLS filtram por ela)
//   app.usuario_id  usuário logado (auditoria das OS)
//   app.plataforma  'on' só para o administrador da plataforma
//
// Desempenho: a API está no Render (Virginia) e o banco no Neon (São Paulo); cada viagem
// ao banco custa ~110 ms. Por isso o contexto NÃO é gravado com uma transação extra a cada
// consulta:
//   1. no início de cada requisição, fn_sessao() confere o usuário do token e grava o
//      contexto na conexão, na MESMA viagem que a autenticação já fazia (auth.js);
//   2. cada conexão do pool lembra qual contexto está gravado nela (CONTEXTO_GRAVADO).
//      Antes de usar uma conexão, comparamos com o contexto da requisição (guardado no
//      AsyncLocalStorage); só se forem diferentes gastamos uma viagem para regravar;
//   3. transação (BEGIN ... COMMIT) só nas escritas com mais de um passo.
// Sem contexto (rotas públicas), a conexão é zerada antes do uso: as políticas não
// deixam ver nenhuma linha. Se não der para confirmar o que está gravado numa conexão
// (erro no meio), ela é descartada, nunca devolvida ao pool.
import { AsyncLocalStorage } from 'node:async_hooks';
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

export const SEM_CONTEXTO = Object.freeze({ empresaId: null, usuarioId: null, plataforma: false });
const CONTEXTO_GRAVADO = Symbol('contextoGravadoNaConexao');
const armazenamento = new AsyncLocalStorage();

const mesmoContexto = (a, b) => a.empresaId === b.empresaId && a.usuarioId === b.usuarioId && a.plataforma === b.plataforma;
const comoTexto = (valor) => (valor === null || valor === undefined ? '' : String(valor));

// Roda fn (e tudo o que ela chamar, inclusive de forma assíncrona) com este contexto.
export function comContexto(contexto, fn) {
  return armazenamento.run(Object.freeze({ ...SEM_CONTEXTO, ...contexto }), fn);
}

export function contextoAtual() {
  return armazenamento.getStore() ?? SEM_CONTEXTO;
}

// Registra o que fn_sessao() acabou de gravar na conexão (ver middlewares/auth.js).
export function marcarContexto(client, contexto) {
  client[CONTEXTO_GRAVADO] = Object.freeze({ ...SEM_CONTEXTO, ...contexto });
}

async function garantirContexto(client, desejado) {
  const gravado = client[CONTEXTO_GRAVADO];
  if (gravado && mesmoContexto(gravado, desejado)) return;
  client[CONTEXTO_GRAVADO] = undefined; // desconhecido até a confirmação
  await client.query(
    `SELECT set_config('app.empresa_id', $1, false),
            set_config('app.usuario_id', $2, false),
            set_config('app.plataforma', $3, false)`,
    [comoTexto(desejado.empresaId), comoTexto(desejado.usuarioId), desejado.plataforma ? 'on' : ''],
  );
  client[CONTEXTO_GRAVADO] = desejado;
}

// Pega uma conexão já com o contexto da requisição atual e a devolve no fim.
// Conexão em estado incerto (erro ao gravar o contexto ou transação que não fechou) é
// destruída: release(true) fecha a conexão em vez de devolvê-la ao pool.
export async function comConexao(fn, contexto = contextoAtual()) {
  const client = await pool.connect();
  let descartar = false;
  try {
    await garantirContexto(client, contexto);
    return await fn(client);
  } catch (erro) {
    descartar = client[CONTEXTO_GRAVADO] === undefined || erro.descartarConexao === true;
    throw erro;
  } finally {
    client.release(descartar || undefined);
  }
}

export function query(texto, parametros) {
  return comConexao((client) => client.query(texto, parametros));
}

// Executa fn(client) numa transação, numa única conexão do pool, com o contexto da
// requisição (empresa e usuário; a trigger trg_auditoria_os lê app.usuario_id).
// Qualquer erro dentro de fn => ROLLBACK e o erro é repassado; nada fica gravado.
export function transacao(fn) {
  return comConexao(async (client) => {
    await client.query('BEGIN');
    try {
      const resultado = await fn(client);
      await client.query('COMMIT');
      return resultado;
    } catch (erro) {
      try {
        await client.query('ROLLBACK');
      } catch {
        erro.descartarConexao = true; // não deu para fechar a transação: conexão fora
      }
      throw erro;
    }
  });
}

// O papel da API não pode ignorar a RLS (superusuário ou BYPASSRLS): senão o isolamento
// entre empresas desaparece em silêncio. Chamado pelo server.js antes de subir.
export async function verificarPapelSemBypass(conexao = pool) {
  const { rows } = await conexao.query(
    'SELECT current_user AS papel, rolsuper OR rolbypassrls AS ignora_rls FROM pg_roles WHERE rolname = current_user',
  );
  if (rows[0].ignora_rls) {
    throw new Error(`O papel ${rows[0].papel} ignora a Row-Level Security. Use o maintos_app no DATABASE_URL.`);
  }
}
