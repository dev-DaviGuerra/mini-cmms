// Regras de autenticação: confere e-mail/senha, emite o JWT e troca a própria senha.
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { ErroNaoAutenticado, ErroValidacao } from '../errors.js';

// Custo do bcrypt: 2^10 rodadas (~70 ms por hash). Lento de propósito contra força bruta.
export const CUSTO_BCRYPT = 10;

// Hash usado quando o e-mail não existe, para que a resposta demore o mesmo
// tempo nos dois casos (não revela, pelo tempo, quais e-mails estão cadastrados).
const HASH_FALSO = bcrypt.hashSync('senha-que-nunca-confere', CUSTO_BCRYPT);

// Login: o e-mail é único na plataforma inteira (empresas e administradores da plataforma).
// fn_login() procura nas duas tabelas de usuários: no login ainda não há empresa no
// contexto, e a RLS não deixaria a API ver o usuário de nenhuma empresa.
export async function login(email, senha) {
  const { rows } = await query(
    `SELECT id, nome, email, senha_hash, perfil, ativo, trocar_senha, empresa_id, empresa_nome
       FROM fn_login($1)`,
    [email.trim().toLowerCase()],
  );
  const usuario = rows[0];

  // compara SEMPRE (mesmo se o usuário não existe ou está inativo): tempo de resposta igual
  const senhaConfere = await bcrypt.compare(senha, usuario?.senha_hash ?? HASH_FALSO);
  if (!usuario || !senhaConfere || !usuario.ativo) {
    // mesma mensagem para e-mail inexistente, senha errada e usuário desativado:
    // não revela se a conta existe nem se foi desativada
    throw new ErroNaoAutenticado('E-mail ou senha inválidos');
  }

  const plataforma = usuario.perfil === 'PLATAFORMA';
  // "emp" = empresa do usuário; o middleware a grava no contexto (app.empresa_id) e a
  // fn_sessao confere, a cada requisição, se o usuário ainda é daquela empresa.
  const token = jwt.sign(
    plataforma ? { nome: usuario.nome, perfil: usuario.perfil, plat: true }
      : { nome: usuario.nome, perfil: usuario.perfil, emp: usuario.empresa_id },
    config.jwtSecret,
    { subject: String(usuario.id), expiresIn: config.jwtExpiresIn, algorithm: 'HS256' },
  );

  return {
    token,
    expiraEm: config.jwtExpiresIn,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      empresaId: usuario.empresa_id,
      empresaNome: usuario.empresa_nome,
      trocarSenha: usuario.trocar_senha,
    },
  };
}

// Troca da própria senha: exige a senha atual (quem pegar um computador com a sessão
// aberta não consegue trocar a senha e "sequestrar" a conta).
// Senha atual errada => 400 (e não 401): o usuário continua autenticado pelo token;
// um 401 faria o front encerrar a sessão por engano.
// Também encerra a troca obrigatória (senha temporária da aprovação).
// A RLS garante que a linha é a do próprio usuário, na própria empresa.
export async function trocarSenha(usuario, senhaAtual, novaSenha) {
  const tabela = usuario.perfil === 'PLATAFORMA' ? 'usuarios_plataforma' : 'usuarios';
  const { rows } = await query(`SELECT senha_hash FROM ${tabela} WHERE id = $1 AND ativo`, [usuario.id]);
  if (!rows.length) throw new ErroNaoAutenticado('Sessão inválida');

  if (!(await bcrypt.compare(senhaAtual, rows[0].senha_hash))) {
    throw new ErroValidacao('Senha atual incorreta', ['senhaAtual não confere']);
  }
  if (await bcrypt.compare(novaSenha, rows[0].senha_hash)) {
    throw new ErroValidacao('A nova senha deve ser diferente da atual', ['novaSenha igual à atual']);
  }

  const hash = await bcrypt.hash(novaSenha, CUSTO_BCRYPT);
  await query(`UPDATE ${tabela} SET senha_hash = $1, trocar_senha = FALSE WHERE id = $2`, [hash, usuario.id]);
}
