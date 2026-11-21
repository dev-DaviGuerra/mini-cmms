// Gestão de usuários (só SUPERVISOR, garantido na rota).
// O hash da senha NUNCA sai daqui: as consultas listam as colunas explicitamente,
// sem "SELECT *", e o RETURNING também não inclui senha_hash.
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { ErroConflito, ErroNaoEncontrado } from '../errors.js';
import { CUSTO_BCRYPT } from './authService.js';

export const PERFIS = Object.freeze(['OPERADOR', 'TECNICO', 'SUPERVISOR']);
const COLUNAS = 'id, nome, email, perfil, ativo';

export async function listarUsuarios() {
  const { rows } = await query(`SELECT ${COLUNAS} FROM usuarios ORDER BY ativo DESC, nome`);
  return rows;
}

export async function criarUsuario({ nome, email, perfil, senha }) {
  const hash = await bcrypt.hash(senha, CUSTO_BCRYPT);
  try {
    const { rows } = await query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4) RETURNING ${COLUNAS}`,
      [nome, email, hash, perfil],
    );
    return rows[0];
  } catch (erro) {
    // 23505 = unique_violation: a UNIQUE de usuarios.email garante a regra, mesmo com
    // dois cadastros simultâneos
    if (erro.code === '23505') {
      throw new ErroConflito('EMAIL_DUPLICADO', `Já existe um usuário com o e-mail ${email}`, { email });
    }
    throw erro;
  }
}

// Ativa/desativa. Desativar não apaga nada: OS e auditoria continuam com o nome da pessoa.
export async function definirAtivo(id, ativo, solicitanteId) {
  if (id === solicitanteId && !ativo) {
    // evita o supervisor se trancar fora do sistema (e o sistema ficar sem supervisor)
    throw new ErroConflito('AUTO_DESATIVACAO', 'Você não pode desativar o seu próprio usuário');
  }
  const { rows } = await query(`UPDATE usuarios SET ativo = $1 WHERE id = $2 RETURNING ${COLUNAS}`, [ativo, id]);
  if (!rows.length) throw new ErroNaoEncontrado(`Usuário ${id} não encontrado`);
  return rows[0];
}
