// Regras de autenticação: confere e-mail/senha e emite o JWT.
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { ErroNaoAutenticado } from '../errors.js';

// Hash usado quando o e-mail não existe, para que a resposta demore o mesmo
// tempo nos dois casos (não revela, pelo tempo, quais e-mails estão cadastrados).
const HASH_FALSO = bcrypt.hashSync('senha-que-nunca-confere', 10);

export async function login(email, senha) {
  const { rows } = await query(
    'SELECT id, nome, email, senha_hash, perfil FROM usuarios WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  const usuario = rows[0];

  const senhaConfere = await bcrypt.compare(senha, usuario?.senha_hash ?? HASH_FALSO);
  if (!usuario || !senhaConfere) {
    // mesma mensagem para e-mail inexistente e senha errada
    throw new ErroNaoAutenticado('E-mail ou senha inválidos');
  }

  const token = jwt.sign(
    { nome: usuario.nome, perfil: usuario.perfil },
    config.jwtSecret,
    { subject: String(usuario.id), expiresIn: config.jwtExpiresIn, algorithm: 'HS256' },
  );

  return {
    token,
    expiraEm: config.jwtExpiresIn,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
  };
}
