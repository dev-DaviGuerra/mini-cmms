// Exige um JWT válido no cabeçalho "Authorization: Bearer <token>".
// Se válido, disponibiliza req.usuario = { id, nome, perfil, empresaId, empresaNome } e roda
// o resto da requisição com o contexto da empresa (db.js: comContexto).
//
// Além de verificar a assinatura e a validade do token, consulta o banco a cada requisição
// com fn_sessao(): se o usuário foi DESATIVADO (ou removido, ou a empresa desativada), o
// token é recusado na hora (401), sem esperar as 8h de expiração. O perfil usado na
// autorização também vem do banco (fonte da verdade), não do token.
//
// Na MESMA viagem ao banco, fn_sessao() grava o contexto da conexão com set_config
// (app.empresa_id, app.usuario_id, app.plataforma). A empresa vem do token, que é
// assinado; mesmo assim a função confere se o usuário é mesmo daquela empresa.
//
// Três portas:
//   autenticar            usuários das empresas (o PLATAFORMA recebe 403)
//   autenticarPlataforma  só o administrador da plataforma
//   autenticarQualquer    os dois (/api/auth/me e /api/auth/senha)
// Usuário com troca de senha obrigatória só acessa /api/auth/me e /api/auth/senha (403).
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool, comContexto, marcarContexto, SEM_CONTEXTO } from '../db.js';
import { ErroApi, ErroNaoAutenticado, ErroProibido } from '../errors.js';

const LIBERADAS_NA_TROCA_DE_SENHA = new Set(['GET /api/auth/me', 'POST /api/auth/senha']);

export class ErroTrocaSenha extends ErroApi {
  constructor() {
    super(403, 'TROCA_SENHA_OBRIGATORIA', 'Troque a senha temporária antes de continuar');
  }
}

const idValido = (n) => Number.isInteger(n) && n > 0;

function lerToken(req) {
  const [esquema, token] = (req.headers.authorization ?? '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    throw new ErroNaoAutenticado('Token ausente. Envie Authorization: Bearer <token>');
  }
  let payload;
  try {
    // algorithms fixo impede o ataque de trocar o algoritmo no cabeçalho do token
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (erro) {
    throw new ErroNaoAutenticado(erro.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido');
  }
  const usuarioId = Number(payload.sub);
  const plataforma = payload.plat === true;
  const empresaId = plataforma ? null : Number(payload.emp);
  if (!idValido(usuarioId) || (!plataforma && !idValido(empresaId))) throw new ErroNaoAutenticado('Token inválido');
  return { usuarioId, empresaId, plataforma };
}

// Uma viagem: confere o usuário e grava o contexto na conexão. A conexão volta ao pool
// marcada com o contexto gravado, e a próxima consulta da requisição normalmente a reaproveita
// sem nova viagem. Em caso de erro, a conexão é descartada (contexto incerto).
async function abrirSessao({ usuarioId, empresaId, plataforma }) {
  const client = await pool.connect();
  let descartar = true;
  try {
    const { rows } = await client.query(
      'SELECT nome, perfil, trocar_senha, empresa_id, empresa_nome FROM fn_sessao($1, $2, $3)',
      [usuarioId, empresaId, plataforma],
    );
    marcarContexto(client, rows.length ? { empresaId, usuarioId, plataforma } : SEM_CONTEXTO);
    descartar = false;
    return rows[0];
  } finally {
    client.release(descartar || undefined);
  }
}

function criarAutenticacao(quem) {
  return async (req, _res, next) => {
    const token = lerToken(req);
    const sessao = await abrirSessao(token);
    if (!sessao) throw new ErroNaoAutenticado('Usuário desativado ou inexistente');

    if (quem === 'EMPRESA' && token.plataforma) {
      throw new ErroProibido('O administrador da plataforma não acessa os dados das empresas');
    }
    if (quem === 'PLATAFORMA' && !token.plataforma) throw new ErroProibido();
    if (sessao.trocar_senha && !LIBERADAS_NA_TROCA_DE_SENHA.has(`${req.method} ${req.baseUrl}${req.path}`)) {
      throw new ErroTrocaSenha();
    }

    req.usuario = {
      id: token.usuarioId,
      nome: sessao.nome,
      perfil: sessao.perfil,
      empresaId: sessao.empresa_id,
      empresaNome: sessao.empresa_nome,
      trocarSenha: sessao.trocar_senha,
    };
    comContexto(token, next);
  };
}

export const autenticar = criarAutenticacao('EMPRESA');
export const autenticarPlataforma = criarAutenticacao('PLATAFORMA');
export const autenticarQualquer = criarAutenticacao('QUALQUER');
