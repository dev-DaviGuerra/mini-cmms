// Exige um JWT válido no cabeçalho "Authorization: Bearer <token>".
// Se válido, disponibiliza req.usuario = { id, nome, perfil } para as próximas camadas.
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { ErroNaoAutenticado } from '../errors.js';

export function autenticar(req, _res, next) {
  const [esquema, token] = (req.headers.authorization ?? '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    return next(new ErroNaoAutenticado('Token ausente. Envie Authorization: Bearer <token>'));
  }

  try {
    // algorithms fixo impede o ataque de trocar o algoritmo no cabeçalho do token
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    req.usuario = { id: Number(payload.sub), nome: payload.nome, perfil: payload.perfil };
    return next();
  } catch (erro) {
    const mensagem = erro.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido';
    return next(new ErroNaoAutenticado(mensagem));
  }
}
