// Utilitários dos testes. "npm test" define NODE_ENV=test, e o config.js passa a usar
// DATABASE_URL_TEST (banco cmms_test), nunca o de desenvolvimento. Esse banco precisa
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

let contadorEquipamentos = 0;
export async function criarEquipamento() {
  contadorEquipamentos += 1;
  const { rows } = await pool.query(
    `INSERT INTO equipamentos (tag, nome, linha, criticidade)
     VALUES ($1, 'Equipamento de teste', 'Linha de teste', 'B') RETURNING id, tag, status`,
    [`T${contadorEquipamentos}-${process.pid}`.slice(0, 20)],
  );
  return rows[0];
}

// Apaga tudo o que os testes criaram, respeitando as chaves estrangeiras:
// movimentações -> OS (os_pecas e os_auditoria caem em cascata) -> equipamentos -> usuários.
export async function removerDados({ usuarios = {}, equipamentos = [] }) {
  const idsUsuarios = Object.values(usuarios).map((u) => u.id);
  const idsEquip = equipamentos.map((e) => e.id);
  await pool.query('DELETE FROM movimentacoes WHERE usuario_id = ANY($1::int[])', [idsUsuarios]);
  await pool.query(
    `DELETE FROM ordens_servico
      WHERE equipamento_id = ANY($1::int[]) OR aberta_por = ANY($2::int[]) OR tecnico_id = ANY($2::int[])`,
    [idsEquip, idsUsuarios],
  );
  await pool.query('DELETE FROM equipamentos WHERE id = ANY($1::int[])', [idsEquip]);
  await pool.query('DELETE FROM usuarios WHERE id = ANY($1::int[])', [idsUsuarios]);
}

export async function removerUsuarios(usuarios) {
  await removerDados({ usuarios });
}

export async function login(app, request, usuario) {
  const res = await request(app).post('/api/auth/login').send({ email: usuario.email, senha: SENHA_TESTE });
  if (res.status !== 200) throw new Error(`login de teste falhou: ${res.status}`);
  return res.body.token;
}

export async function encerrar() {
  await pool.end();
}
