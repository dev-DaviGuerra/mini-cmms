// Painel do administrador da plataforma: solicitações de acesso (aprovar/recusar) e
// lista de empresas. A senha temporária da aprovação só existe na resposta da API e só
// aparece no drawer; ao fechar, é apagada da tela.
import { api, exigirLogin, ErroApi } from './api.js';
import {
  el, limpar, montarLayout, criarDrawer, mostrarMensagem, esconderMensagem, estadoVazio,
  formatarDataHoraCurta, avisar,
} from './ui.js';

const usuario = await exigirLogin({ plataforma: true });
montarLayout(usuario, 'plataforma');

const $ = (id) => document.getElementById(id);
const caixa = $('mensagem');
const lista = $('lista-solicitacoes');
const ROTULO_STATUS = { PENDENTE: 'pendentes', APROVADA: 'aprovadas', RECUSADA: 'recusadas' };
let statusAtual = 'PENDENTE';
let selecionada = null;

// O botão que abriu o drawer some quando a lista é recarregada: o foco volta ao título.
function focoNaLista() {
  setTimeout(() => {
    if (document.activeElement === document.body || !document.activeElement?.isConnected) $('titulo-solicitacoes').focus();
  });
}

function erroParaTela(alvo, erro, prefixo = '') {
  const detalhes = erro instanceof ErroApi && Array.isArray(erro.detalhes) ? erro.detalhes : null;
  mostrarMensagem(alvo, prefixo + (erro instanceof ErroApi ? erro.mensagem : `Erro inesperado: ${erro.message}`), 'erro', detalhes);
}

// ---- solicitações ---------------------------------------------------------------------
function dado(rotulo, valor, classe) {
  return [el('dt', { texto: rotulo }), el('dd', { texto: valor, ...(classe ? { classe } : {}) })];
}

function cartao(s) {
  const detalhes = el('dl', {}, [
    ...dado('Responsável', s.responsavel),
    ...dado('E-mail', s.email, 'mono'),
    ...dado('Local', `${s.cidade}/${s.uf}`),
    ...dado('Equipamentos', String(s.equipamentos_aprox), 'mono'),
    ...dado('Pedido em', formatarDataHoraCurta(s.criada_em), 'mono'),
    ...(s.decidida_em ? dado('Decidido em', formatarDataHoraCurta(s.decidida_em), 'mono') : []),
    ...(s.motivo_recusa ? dado('Motivo', s.motivo_recusa) : []),
  ]);
  const filhos = [el('div', {}, [el('h3', { texto: s.empresa_nome }), detalhes])];
  if (s.status === 'PENDENTE') {
    const aprovar = el('button', { classe: 'botao primario', texto: 'Aprovar', attrs: { type: 'button', 'aria-label': `Aprovar ${s.empresa_nome}`, 'aria-haspopup': 'dialog' } });
    const recusar = el('button', { classe: 'botao secundario', texto: 'Recusar', attrs: { type: 'button', 'aria-label': `Recusar ${s.empresa_nome}`, 'aria-haspopup': 'dialog' } });
    aprovar.addEventListener('click', () => abrirAprovar(s, aprovar));
    recusar.addEventListener('click', () => abrirRecusar(s, recusar));
    filhos.push(el('div', { classe: 'acoes' }, [aprovar, recusar]));
  }
  return el('li', { classe: `cartao-solicitacao ${s.status.toLowerCase()}` }, filhos);
}

async function carregarSolicitacoes() {
  limpar(lista);
  lista.setAttribute('aria-busy', 'true');
  lista.append(el('li', { classe: 'texto-suave', texto: 'Carregando…' }));
  try {
    const itens = await api.get(`/plataforma/solicitacoes?status=${statusAtual}`);
    limpar(lista);
    if (!itens.length) {
      lista.append(el('li', {}, [estadoVazio({ titulo: `Nenhuma solicitação ${ROTULO_STATUS[statusAtual]}`, texto: 'Os pedidos feitos em "Solicitar acesso" aparecem aqui.' })]));
    }
    for (const s of itens) lista.append(cartao(s));
  } catch (erro) {
    limpar(lista);
    erroParaTela(caixa, erro, 'Não foi possível carregar as solicitações: ');
  } finally {
    lista.removeAttribute('aria-busy');
  }
}

for (const radio of document.querySelectorAll('input[name="status"]')) {
  radio.addEventListener('change', () => {
    statusAtual = radio.value;
    // void: tratador de evento não espera a promessa; os erros já viram mensagem na tela
    void carregarSolicitacoes();
  });
}

// ---- empresas -------------------------------------------------------------------------
async function carregarEmpresas() {
  const linhas = $('linhas-empresas');
  linhas.setAttribute('aria-busy', 'true');
  try {
    const empresas = await api.get('/plataforma/empresas');
    limpar(linhas);
    for (const e of empresas) {
      linhas.append(el('tr', {}, [
        el('td', { texto: e.nome }),
        el('td', { texto: e.cidade ? `${e.cidade}/${e.uf}` : '—' }),
        el('td', { classe: 'mono', texto: formatarDataHoraCurta(e.criada_em) }),
        el('td', {}, [el('span', { classe: `status ${e.ativa ? 'ativo' : 'inativo'}`, texto: e.ativa ? 'Ativa' : 'Inativa' })]),
      ]));
    }
  } catch (erro) {
    erroParaTela(caixa, erro, 'Não foi possível carregar as empresas: ');
  } finally {
    linhas.removeAttribute('aria-busy');
  }
}

// ---- aprovar --------------------------------------------------------------------------
const caixaAprovar = $('mensagem-aprovar');
const botaoConfirmar = $('botao-confirmar-aprovar');
const drawerAprovar = criarDrawer({
  drawer: $('drawer-aprovar'),
  fundo: $('fundo-aprovar'),
  primeiroCampo: botaoConfirmar,
  aoFechar: () => {
    // a senha temporária não fica na página depois de fechar
    $('senha-temporaria').textContent = '';
    $('aviso-copia-senha').textContent = '';
    esconderMensagem(caixaAprovar);
    focoNaLista();
  },
});

function abrirAprovar(s, origem) {
  selecionada = s;
  $('aprovar-empresa').textContent = s.empresa_nome;
  $('aprovar-responsavel').textContent = s.responsavel;
  $('aprovar-email').textContent = s.email;
  $('passo-confirmar').hidden = false;
  $('passo-senha').hidden = true;
  $('botao-cancelar-aprovar').hidden = false;
  botaoConfirmar.hidden = false;
  botaoConfirmar.disabled = false;
  $('botao-concluir').hidden = true;
  drawerAprovar.abrir(origem);
}

botaoConfirmar.addEventListener('click', async () => {
  esconderMensagem(caixaAprovar);
  botaoConfirmar.disabled = true;
  try {
    const r = await api.post(`/plataforma/solicitacoes/${selecionada.id}/aprovar`);
    $('senha-temporaria').textContent = r.senhaTemporaria;
    $('senha-email').textContent = r.supervisor.email;
    $('passo-confirmar').hidden = true;
    $('passo-senha').hidden = false;
    botaoConfirmar.hidden = true;
    $('botao-cancelar-aprovar').hidden = true;
    $('botao-concluir').hidden = false;
    $('copiar-senha').focus();
    avisar(`Empresa ${r.empresa.nome} criada.`);
    await Promise.all([carregarSolicitacoes(), carregarEmpresas()]);
  } catch (erro) {
    erroParaTela(caixaAprovar, erro, 'Não foi possível aprovar: ');
    botaoConfirmar.disabled = false;
  }
});

$('copiar-senha').addEventListener('click', async () => {
  const codigo = $('senha-temporaria');
  try {
    await navigator.clipboard.writeText(codigo.textContent);
    $('aviso-copia-senha').textContent = 'Senha copiada.';
  } catch {
    const intervalo = document.createRange();
    intervalo.selectNodeContents(codigo);
    const selecao = globalThis.getSelection();
    selecao.removeAllRanges();
    selecao.addRange(intervalo);
    $('aviso-copia-senha').textContent = 'Senha selecionada: use Ctrl+C.';
  }
});

// ---- recusar --------------------------------------------------------------------------
const formRecusar = $('form-recusar');
const caixaRecusar = $('mensagem-recusar');
const drawerRecusar = criarDrawer({
  drawer: $('drawer-recusar'),
  fundo: $('fundo-recusar'),
  primeiroCampo: $('motivo'),
  aoFechar: () => { formRecusar.reset(); esconderMensagem(caixaRecusar); focoNaLista(); },
});

function abrirRecusar(s, origem) {
  selecionada = s;
  $('recusar-empresa').textContent = s.empresa_nome;
  drawerRecusar.abrir(origem);
}

formRecusar.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixaRecusar);
  const motivo = formRecusar.motivo.value.trim();
  if (motivo && motivo.length < 3) {
    mostrarMensagem(caixaRecusar, 'O motivo deve ter pelo menos 3 caracteres (ou fique em branco).');
    return;
  }
  const botao = formRecusar.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    await api.post(`/plataforma/solicitacoes/${selecionada.id}/recusar`, motivo ? { motivo } : {});
    drawerRecusar.fechar();
    avisar(`Pedido de ${selecionada.empresa_nome} recusado.`);
    await carregarSolicitacoes();
  } catch (erro) {
    erroParaTela(caixaRecusar, erro, 'Não foi possível recusar: ');
  } finally {
    botao.disabled = false;
  }
});

await Promise.all([carregarSolicitacoes(), carregarEmpresas()]);
