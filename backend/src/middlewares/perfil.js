// Autorização por perfil. Usar DEPOIS de autenticar:
//   router.post('/', autenticar, exigirPerfil('SUPERVISOR'), handler)
import { ErroNaoAutenticado, ErroProibido } from '../errors.js';

export const PERFIS = Object.freeze(['OPERADOR', 'TECNICO', 'SUPERVISOR']);

export function exigirPerfil(...permitidos) {
  const invalidos = permitidos.filter((p) => !PERFIS.includes(p));
  if (invalidos.length) throw new Error(`Perfil desconhecido: ${invalidos.join(', ')}`);

  return (req, _res, next) => {
    if (!req.usuario) return next(new ErroNaoAutenticado());
    if (!permitidos.includes(req.usuario.perfil)) return next(new ErroProibido());
    return next();
  };
}
