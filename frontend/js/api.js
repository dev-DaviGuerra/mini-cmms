// Módulo central de acesso à API.
// - Envia o token JWT (guardado no sessionStorage) em toda requisição.
// - Converte respostas de erro { erro: { codigo, mensagem, detalhes } } em ErroApi.
// - Em 401 com sessão aberta (token expirado ou inválido), encerra a sessão e volta ao login.
//
// sessionStorage (e não localStorage): o token some ao fechar a aba/navegador, o que reduz
// o tempo em que um token esquecido num computador compartilhado continua válido.

const BASE = '/api';
const CHAVE_TOKEN = 'cmms.token';
const CHAVE_USUARIO = 'cmms.usuario';

export class ErroApi extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.mensagem = mensagem; // mesmo texto de .message, com o nome usado pela API
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export function usuarioAtual() {
  try {
    return JSON.parse(sessionStorage.getItem(CHAVE_USUARIO));
  } catch {
    return null;
  }
}

function temSessao() {
  return Boolean(sessionStorage.getItem(CHAVE_TOKEN) && usuarioAtual());
}

// Encerra a sessão e volta para a tela de login. motivo: 'expirada' | 'saiu' | undefined
export function sair(motivo) {
  sessionStorage.removeItem(CHAVE_TOKEN);
  sessionStorage.removeItem(CHAVE_USUARIO);
  // login.html (a raiz / é a landing page pública)
  const destino = motivo ? `login.html?motivo=${encodeURIComponent(motivo)}` : 'login.html';
  window.location.replace(destino);
}

// Página inicial de cada usuário (multiempresa, #41):
//   senha temporária -> trocar-senha.html (troca obrigatória antes de qualquer outra tela)
//   PLATAFORMA       -> plataforma.html (não vê as telas das empresas)
//   empresas         -> os.html
export function paginaInicial(usuario) {
  if (usuario?.trocarSenha) return 'trocar-senha.html';
  return usuario?.perfil === 'PLATAFORMA' ? 'plataforma.html' : 'os.html';
}

// Depois da troca obrigatória: a sessão continua, sem a marca de senha temporária.
export function marcarSenhaTrocada() {
  const usuario = usuarioAtual();
  if (usuario) sessionStorage.setItem(CHAVE_USUARIO, JSON.stringify({ ...usuario, trocarSenha: false }));
}

const nuncaResolve = () => new Promise(() => {});

// Usar no início de cada página protegida:  const usuario = await exigirLogin();
// Sem sessão => vai para o login e devolve uma promessa que nunca se resolve: o resto do
// script da página simplesmente não roda (sem lançar erro no console).
// { plataforma: true } nas páginas do PLATAFORMA. Quem cai na página errada (ou ainda tem
// senha temporária) vai para a própria página inicial. Só conforto: a API responde 403.
export function exigirLogin({ plataforma = false } = {}) {
  if (!temSessao()) {
    sair();
    return nuncaResolve();
  }
  const usuario = usuarioAtual();
  const ehPlataforma = usuario.perfil === 'PLATAFORMA';
  if (usuario.trocarSenha || ehPlataforma !== plataforma) {
    window.location.replace(paginaInicial(usuario));
    return nuncaResolve();
  }
  return Promise.resolve(usuario);
}

export function jaLogado() {
  return temSessao();
}

async function requisicao(metodo, caminho, corpo) {
  const token = sessionStorage.getItem(CHAVE_TOKEN);
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';

  let resposta;
  try {
    resposta = await fetch(BASE + caminho, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi(0, 'SEM_CONEXAO', 'Não foi possível falar com o servidor. Verifique se a API está no ar.');
  }

  const dados = await resposta.json().catch(() => null);
  if (resposta.ok) return dados;

  const erro = dados?.erro ?? {};
  if (resposta.status === 401 && token) {
    sair('expirada'); // token expirado/inválido: o servidor não reconhece mais a sessão
  }
  if (resposta.status === 403 && erro.codigo === 'TROCA_SENHA_OBRIGATORIA') {
    window.location.replace('trocar-senha.html'); // senha temporária: troca antes de tudo
  }
  throw new ErroApi(resposta.status, erro.codigo ?? 'ERRO', erro.mensagem ?? `Erro ${resposta.status}`, erro.detalhes);
}

export const api = {
  get: (caminho) => requisicao('GET', caminho),
  post: (caminho, corpo = {}) => requisicao('POST', caminho, corpo),
  patch: (caminho, corpo = {}) => requisicao('PATCH', caminho, corpo),
};

export async function entrar(email, senha) {
  const r = await requisicao('POST', '/auth/login', { email, senha });
  sessionStorage.setItem(CHAVE_TOKEN, r.token);
  sessionStorage.setItem(CHAVE_USUARIO, JSON.stringify(r.usuario));
  return r.usuario;
}
