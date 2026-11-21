// Regras de negócio de equipamentos (H5).
import { query } from '../db.js';
import { ErroConflito } from '../errors.js';

export const CRITICIDADES = Object.freeze(['A', 'B', 'C']);

// Lista todos os equipamentos com o status atual e quantas OS pendentes cada um tem.
export async function listarEquipamentos() {
  const { rows } = await query(`
    SELECT e.id, e.tag, e.nome, e.linha, e.criticidade, e.status,
           COUNT(os.id)::int AS os_pendentes
      FROM equipamentos e
      LEFT JOIN ordens_servico os
             ON os.equipamento_id = e.id
            AND os.status IN ('ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO_PECA')
     GROUP BY e.id
     ORDER BY e.tag`);
  return rows;
}

// Cadastra um equipamento novo (sempre começa OPERANDO).
export async function criarEquipamento({ tag, nome, linha, criticidade }) {
  try {
    const { rows } = await query(
      `INSERT INTO equipamentos (tag, nome, linha, criticidade)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tag, nome, linha, criticidade, status`,
      [tag, nome, linha, criticidade],
    );
    return rows[0];
  } catch (erro) {
    // 23505 = unique_violation: o banco (UNIQUE em tag) é quem garante a regra,
    // mesmo com dois cadastros simultâneos
    if (erro.code === '23505') {
      throw new ErroConflito('TAG_DUPLICADA', `Já existe um equipamento com a tag ${tag}`, { tag });
    }
    throw erro;
  }
}
