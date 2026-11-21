// Lista de OS com filtros e paginação; formulário de abertura para OPERADOR e SUPERVISOR.
import { api, exigirLogin, ErroApi } from './api.js';
import {
  el, limpar, badgeStatus, badgePrioridade, formatarDataHora, preencherSelect,
  mostrarMensagem, esconderMensagem, montarCabecalho,
  ROTULOS_STATUS, ROTULOS_PRIORIDADE, ROTULOS_TIPO,
} from './ui.js';

const usuario = await exigirLogin();
montarCabecalho(usuario, 'os');

const POR_PAGINA = 20;
let offset = 0;
let total = 0;

const $ = (id) => document.getElementById(id);
const caixa = $('mensagem');
const filtros = $('filtros');
const linhas = $('linhas');
const formNova = $('form-nova');
const secaoNova = $('secao-nova');

function erroParaTela(erro, prefixo = '') {
  if (erro instanceof ErroApi) {
    mostrarMensagem(caixa, prefixo + erro.mensagem, 'erro', Array.isArray(erro.detalhes) ? erro.detalhes : null);
  } else {
    mostrarMensagem(caixa, `${prefixo}Erro inesperado: ${erro.message}`);
  }
}

// ---- equipamentos (filtro e formulário) -------------------------------------------
async function carregarEquipamentos() {
  const equipamentos = await api.get('/equipamentos');
  const filtroEq = $('filtro-equipamento');
  const novaEq = $('nova-equipamento');
  const selecionadoFiltro = filtroEq.value;
  filtroEq.length = 1; // mantém "Todos"
  novaEq.length = 1;   // mantém "Selecione…"
  preencherSelect(filtroEq, equipamentos.map((e) => [e.id, `${e.tag} — ${e.nome}`]));
  preencherSelect(novaEq, equipamentos.map((e) => [e.id, `${e.tag} — ${e.nome} (${e.status === 'PARADO' ? 'parado' : 'operando'})`]));
  filtroEq.value = selecionadoFiltro;
}

// ---- lista ------------------------------------------------------------------------
function linhaOs(os) {
  const linkOs = el('a', { texto: `#${os.id}`, attrs: { href: `os-detalhe.html?id=${encodeURIComponent(os.id)}` } });
  return el('tr', {}, [
    el('td', {}, [linkOs]),
    el('td', {}, [
      el('span', { classe: 'tag-equip', texto: os.equipamento_tag }),
      el('span', { classe: 'texto-secundario', texto: os.equipamento_nome }),
    ]),
    el('td', { texto: ROTULOS_TIPO[os.tipo] ?? os.tipo }),
    el('td', {}, [badgePrioridade(os.prioridade)]),
    el('td', {}, [badgeStatus(os.status)]),
    el('td', { texto: formatarDataHora(os.aberta_em) }),
    el('td', { texto: os.tecnico_nome ?? '—' }),
  ]);
}

async function carregarLista() {
  const parametros = new URLSearchParams();
  for (const [nome, valor] of new FormData(filtros)) if (valor) parametros.set(nome, valor);
  parametros.set('limit', POR_PAGINA);
  parametros.set('offset', offset);

  linhas.setAttribute('aria-busy', 'true');
  try {
    const { dados, paginacao } = await api.get(`/os?${parametros}`);
    total = paginacao.total;
    limpar(linhas);
    if (!dados.length) {
      linhas.append(el('tr', {}, [el('td', { classe: 'vazio', texto: 'Nenhuma OS encontrada com esses filtros.', attrs: { colspan: 7 } })]));
    }
    for (const os of dados) linhas.append(linhaOs(os));

    const de = total ? offset + 1 : 0;
    const ate = Math.min(offset + POR_PAGINA, total);
    $('info-paginacao').textContent = `${de}–${ate} de ${total}`;
    $('botao-anterior').disabled = offset === 0;
    $('botao-proxima').disabled = offset + POR_PAGINA >= total;
  } catch (erro) {
    erroParaTela(erro, 'Não foi possível carregar as OS: ');
  } finally {
    linhas.removeAttribute('aria-busy');
  }
}

function recarregarDoInicio() {
  offset = 0;
  return carregarLista();
}

// ---- abrir OS (OPERADOR e SUPERVISOR) ---------------------------------------------
// A tela só esconde o botão; quem garante a permissão é a API (403 para outros perfis).
const podeAbrir = ['OPERADOR', 'SUPERVISOR'].includes(usuario.perfil);
$('botao-nova').hidden = !podeAbrir;

$('botao-nova').addEventListener('click', () => {
  secaoNova.hidden = false;
  $('nova-equipamento').focus();
});
$('botao-cancelar-nova').addEventListener('click', () => {
  formNova.reset();
  secaoNova.hidden = true;
});

formNova.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixa);
  const dados = {
    equipamentoId: Number(formNova.equipamentoId.value),
    tipo: formNova.tipo.value,
    prioridade: formNova.prioridade.value,
    descricao: formNova.descricao.value.trim(),
  };

  // Conferência rápida na tela, com mensagens amigáveis. É só conforto para o usuário:
  // a validação que vale é a da API (que responde 400 se algo passar daqui).
  const problemas = [];
  if (!dados.equipamentoId) problemas.push('Selecione o equipamento.');
  if (dados.descricao.length < 5) problemas.push('Descreva a falha (mínimo de 5 caracteres).');
  if (problemas.length) {
    mostrarMensagem(caixa, 'Confira os campos da OS:', 'erro', problemas);
    return;
  }

  const botao = formNova.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    const os = await api.post('/os', dados);
    mostrarMensagem(caixa, `OS #${os.id} aberta para ${os.equipamento_tag}. O equipamento agora está PARADO.`, 'sucesso');
    formNova.reset();
    secaoNova.hidden = true;
    await carregarEquipamentos();
    await recarregarDoInicio();
  } catch (erro) {
    erroParaTela(erro, 'A OS não foi aberta: ');
  } finally {
    botao.disabled = false;
  }
});

// ---- eventos dos filtros e da paginação -------------------------------------------
// carregarLista() trata os próprios erros (mostra a mensagem na tela) e nunca rejeita;
// por isso, nos tratadores de evento, a promessa é ignorada de forma explícita com "void".
filtros.addEventListener('change', () => { void recarregarDoInicio(); });
filtros.addEventListener('submit', (e) => { e.preventDefault(); void recarregarDoInicio(); });
$('botao-limpar').addEventListener('click', () => { filtros.reset(); void recarregarDoInicio(); });
$('botao-atualizar').addEventListener('click', () => { void carregarLista(); });
$('botao-anterior').addEventListener('click', () => {
  offset = Math.max(0, offset - POR_PAGINA);
  void carregarLista();
});
$('botao-proxima').addEventListener('click', () => {
  if (offset + POR_PAGINA >= total) return;
  offset += POR_PAGINA;
  void carregarLista();
});

// ---- início ----------------------------------------------------------------------
preencherSelect($('filtro-status'), Object.entries(ROTULOS_STATUS));
preencherSelect($('filtro-prioridade'), Object.entries(ROTULOS_PRIORIDADE));
preencherSelect($('nova-tipo'), Object.entries(ROTULOS_TIPO));
preencherSelect($('nova-prioridade'), Object.entries(ROTULOS_PRIORIDADE));
$('nova-prioridade').value = 'MEDIA';

try {
  await carregarEquipamentos();
} catch (erro) {
  erroParaTela(erro, 'Não foi possível carregar os equipamentos: ');
}
await carregarLista();
