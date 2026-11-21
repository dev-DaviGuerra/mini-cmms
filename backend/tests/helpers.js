// Utilitários dos testes. Os testes usam o banco de DATABASE_URL (backend/.env), que precisa
// ter os scripts database/01..03 aplicados. Cada arquivo cria seus próprios dados com o
// prefixo "teste-" e os remove no final, sem depender do seed.
import bcrypt from 'bcrypt';
import { pool } from '../src/db.js';

export const SENHA_TESTE = 'senha-de-teste-123';
const sufixo = `${process.pid}-${Date.now()}`;

export async function criarUsuarios() {
  const hash = await bcrypt.hash(SENHA_TESTE, 4); // custo baixo só para o teste ser rápido
  const usuarios = {};
  for (const perfil of ['OPERADOR', 'TECNICO', 'SUPERVISOR']) {
    const email = `teste-${perfil.toLowerCase()}-${sufixo}@cmms.local`;
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil)
       VALUES ($1, $2, $3, $4) RETURNING id, email, perfil`,
      [`Teste ${perfil}`, email, hash, perfil],
    );
    usuarios[perfil] = rows[0];
  }
  return usuarios;
}

export async function removerUsuarios(usuarios) {
  const ids = Object.values(usuarios).map((u) => u.id);
  await pool.query('DELETE FROM usuarios WHERE id = ANY($1::int[])', [ids]);
}

export async function encerrar() {
  await pool.end();
}
