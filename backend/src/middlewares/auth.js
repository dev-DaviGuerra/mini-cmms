// Exige um JWT válido no cabeçalho "Authorization: Bearer <token>".
// Se válido, disponibiliza req.usuario = { id, nome, perfil } para as próximas camadas.
//
// Além de verificar a assinatura e a validade do token, consulta o banco a cada requisição:
// se o usuário foi DESATIVADO (ou removido), o token é recusado na hora (401), sem esperar
// as 8h de expiração. O perfil usado na autorização também vem do banco (fonte da verdade),
// não do token, então uma mudança de perfil vale imediatamente.
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { ErroNaoAutenticado } from '../errors.js';

export async function autenticar(req, _res, next) {
  const [esquema, token] = (req.headers.authorization ?? '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    return next(new ErroNaoAutenticado('Token ausente. Envie Authorization: Bearer <token>'));
  }

  let payload;
  try {
    // algorithms fixo impede o ataque de trocar o algoritmo no cabeçalho do token
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (erro) {
    const mensagem = erro.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido';
    return next(new ErroNaoAutenticado(mensagem));
  }

  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id <= 0) return next(new ErroNaoAutenticado('Token inválido'));

  const { rows } = await query('SELECT nome, perfil, ativo FROM usuarios WHERE id = $1', [id]);
  if (!rows.length || !rows[0].ativo) {
    return next(new ErroNaoAutenticado('Usuário desativado ou inexistente'));
  }

  req.usuario = { id, nome: rows[0].nome, perfil: rows[0].perfil };
  return next();
}
