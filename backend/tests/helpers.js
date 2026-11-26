// Utilitários dos testes. "npm test" define NODE_ENV=test, e o config.js passa a usar
// DATABASE_URL_TEST (banco cmms_test), nunca o de desenvolvimento. Esse banco precisa ter
// os scripts database/01, 02, 03, 05 e 06 aplicados.
//
// Multiempresa (#41): a API dos testes conecta como maintos_app (com RLS), igual à
// produção. A PREPARAÇÃO e as conferências diretas no banco usam o DONO das tabelas
// (DATABASE_URL_TEST_ADMIN), que passa pela RLS. Cada arquivo de teste cria a sua própria
// empresa ("teste-..."); o `pool` exportado aqui grava o contexto dessa empresa em cada
// conexão, então os INSERTs diretos dos testes herdam o empresa_id pelo DEFAULT da coluna.
// No fim, encerrar() apaga tudo o que pertence às empresas criadas pelo arquivo.
import bcrypt from 'bcrypt';
import pg from 'pg';
import { config } from '../src/config.js';
import { pool as poolApi, configConexao } from '../src/db.js';

export const SENHA_TESTE = 'senha-de-teste-123';
const sufixo = `${process.pid}-${Date.now()}`;

if (!config.databaseUrlAdmin) {
  throw new Error('Defina DATABASE_URL_TEST_ADMIN (dono das tabelas do banco de teste) no backend/.env.');
}

const empresasCriadas = [];
const poolsAdmin = [];

// Cria uma empresa de teste e devolve um pool do dono com o contexto dela em cada conexão
// (app.empresa_id e o DEFAULT das colunas). O evento 'connect' enfileira o set_config antes
// de qualquer consulta da conexão.
export async function criarEmpresaDeTeste(rotulo = 'A') {
  const avulso = new pg.Client(configConexao(config.databaseUrlAdmin));
  await avulso.connect();
  const { rows } = await avulso.query(
    'INSERT INTO empresas (nome, cidade, uf) VALUES ($1, $2, $3) RETURNING id, nome',
    [`teste-${rotulo}-${sufixo}`, 'Cidade de teste', 'SP'],
  );
  await avulso.end();
  const empresa = rows[0];
  empresasCriadas.push(empresa.id);

  const pool = new pg.Pool({ ...configConexao(config.databaseUrlAdmin), max: 4 });
  pool.on('connect', (client) => {
    client.query("SELECT set_config('app.empresa_id', $1, false)", [String(empresa.id)]);
  });
  poolsAdmin.push(pool);
  return { ...empresa, pool };
}

// Empresas criadas pela API durante o teste (aprovação de solicitação) entram na limpeza
export function registrarEmpresa(id) {
  empresasCriadas.push(id);
}

// Empresa padrão do arquivo de teste
const padrao = await criarEmpresaDeTeste();
export const EMPRESA_ID = padrao.id;
export const pool = padrao.pool;

// Cria um usuário por perfil, mais um segundo técnico (chave TECNICO2) para os testes
// de "só o técnico que assumiu" e de concorrência.
export async function criarUsuarios(empresa = padrao, rotulo = '') {
  const hash = await bcrypt.hash(SENHA_TESTE, 4); // custo baixo só para o teste ser rápido
  const usuarios = {};
  const lista = [['OPERADOR', 'OPERADOR'], ['TECNICO', 'TECNICO'], ['TECNICO2', 'TECNICO'], ['SUPERVISOR', 'SUPERVISOR']];
  for (const [chave, perfil] of lista) {
    const email = `teste-${chave.toLowerCase()}${rotulo}-${sufixo}@cmms.local`;
    const { rows } = await empresa.pool.query(
      `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, perfil, empresa_id`,
      [empresa.id, `Teste ${chave}${rotulo}`, email, hash, perfil],
    );
    usuarios[chave] = rows[0];
  }
  return usuarios;
}

// Abre uma OS direto pela API (como operador) e devolve o corpo da resposta
export async function abrirOs(app, request, token, equipamentoId, extra = {}) {
  const res = await request(app)
    .post('/api/os')
    .set('Authorization', `Bearer ${token}`)
    .send({ equipamentoId, descricao: 'OS criada pelo teste', ...extra });
  if (res.status !== 201) throw new Error(`abrir OS de teste falhou: ${res.status}`);
  return res.body;
}

let contadorEquipamentos = 0;
export async function criarEquipamento(empresa = padrao) {
  contadorEquipamentos += 1;
  const { rows } = await empresa.pool.query(
    `INSERT INTO equipamentos (empresa_id, tag, nome, linha, criticidade)
     VALUES ($1, $2, 'Equipamento de teste', 'Linha de teste', 'B') RETURNING id, tag, status`,
    [empresa.id, `T${contadorEquipamentos}-${process.pid}`.slice(0, 20)],
  );
  return rows[0];
}

let contadorPecas = 0;
export async function criarPeca({ estoque, estoqueMin = 0, custoUnit = 10 }, empresa = padrao) {
  contadorPecas += 1;
  const { rows } = await empresa.pool.query(
    `INSERT INTO pecas (empresa_id, codigo, descricao, estoque, estoque_min, custo_unit)
     VALUES ($1, $2, 'Peça de teste', $3, $4, $5) RETURNING id, codigo, estoque, estoque_min, custo_unit`,
    [empresa.id, `TP${contadorPecas}-${process.pid}`.slice(0, 20), estoque, estoqueMin, custoUnit],
  );
  return rows[0];
}

// Apaga tudo o que os testes criaram, respeitando as chaves estrangeiras:
// movimentações e alertas -> OS (os_pecas e os_auditoria caem em cascata) -> peças,
// equipamentos -> usuários.
export async function removerDados({ usuarios = {}, equipamentos = [], pecas = [] }) {
  const idsUsuarios = Object.values(usuarios).map((u) => u.id);
  const idsEquip = equipamentos.map((e) => e.id);
  const idsPecas = pecas.map((p) => p.id);
  await pool.query(
    'DELETE FROM movimentacoes WHERE usuario_id = ANY($1::int[]) OR peca_id = ANY($2::int[])',
    [idsUsuarios, idsPecas],
  );
  await pool.query('DELETE FROM alertas_estoque WHERE peca_id = ANY($1::int[])', [idsPecas]);
  await pool.query(
    `DELETE FROM ordens_servico
      WHERE equipamento_id = ANY($1::int[]) OR aberta_por = ANY($2::int[]) OR tecnico_id = ANY($2::int[])`,
    [idsEquip, idsUsuarios],
  );
  await pool.query('DELETE FROM pecas WHERE id = ANY($1::int[])', [idsPecas]);
  await pool.query('DELETE FROM equipamentos WHERE id = ANY($1::int[])', [idsEquip]);
  await pool.query('DELETE FROM usuarios WHERE id = ANY($1::int[])', [idsUsuarios]);
}

export async function removerUsuarios(usuarios) {
  await removerDados({ usuarios });
}

export async function login(app, request, usuario, senha = SENHA_TESTE) {
  const res = await request(app).post('/api/auth/login').send({ email: usuario.email, senha });
  if (res.status !== 200) throw new Error(`login de teste falhou: ${res.status}`);
  return res.body.token;
}

// Apaga TUDO das empresas criadas por este arquivo (na ordem das FKs) e fecha os pools.
const ORDEM_LIMPEZA = ['movimentacoes', 'alertas_estoque', 'os_auditoria', 'os_pecas', 'ordens_servico',
  'pecas', 'equipamentos', 'usuarios'];
export async function encerrar() {
  for (const tabela of ORDEM_LIMPEZA) {
    await pool.query(`DELETE FROM ${tabela} WHERE empresa_id = ANY($1::int[])`, [empresasCriadas]);
  }
  await pool.query('DELETE FROM solicitacoes_acesso WHERE empresa_id = ANY($1::int[])', [empresasCriadas]);
  await pool.query('DELETE FROM empresas WHERE id = ANY($1::int[])', [empresasCriadas]);
  await Promise.all([poolApi.end(), ...poolsAdmin.map((p) => p.end())]);
}
