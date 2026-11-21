// Lista de OS: indicadores, filtros, paginação e drawer "Nova OS" (OPERADOR e SUPERVISOR).
import { api, exigirLogin, ErroApi } from './api.js';
import {
  el, limpar, marcaStatus, marcaPrioridade, formatarDataHoraCurta, preencherSelect, classeDe,
  mostrarMensagem, esconderMensagem, montarLayout, linhasSkeleton, estadoVazio,
  ROTULOS_STATUS, ROTULOS_PRIORIDADE, ROTULOS_TIPO,
} from './ui.js';

const usuario = await exigirLogin();
montarLayout(usuario, 'os');

const POR_PAGINA = 20;
let offset = 0;
let total = 0;

const $ = (id) => document.getElementById(id);
const caixa = $('mensagem');
const filtros = $('filtros');
const linhas = $('linhas');

function mensagemDeErro(alvo, erro, prefixo = '') {
  if (erro instanceof ErroApi) {
    mostrarMensagem(alvo, prefixo + erro.mensagem, 'erro', Array.isArray(erro.detalhes) ? erro.detalhes : null);
  } else {
    mostrarMensagem(alvo, `${prefixo}Erro inesperado: ${erro.message}`);
  }
}

// ---- indicadores (GET /api/kpis/resumo) --------------------------------------------
const botoesIndicador = [...document.querySelectorAll('.indicador[data-status]')];

async function carregarIndicadores() {
  try {
    const r = await api.get('/kpis/resumo');
    $('kpi-abertas').textContent = r.os_abertas;
    $('kpi-andamento').textContent = r.os_em_andamento;
    $('kpi-aguardando').textContent = r.os_aguardando_peca;
    $('kpi-parados').textContent = r.equipamentos_parados;
  } catch {
    for (const id of ['kpi-abertas', 'kpi-andamento', 'kpi-aguardando', 'kpi-parados']) $(id).textContent = '—';
  }
}

// o indicador do status filtrado fica "pressionado"
function sincronizarIndicadores() {
  const status = filtros.status.value;
  for (const b of botoesIndicador) b.setAttribute('aria-pressed', String(b.dataset.status === status));
}

for (const botao of botoesIndicador) {
  botao.addEventListener('click', () => {
    filtros.status.value = filtros.status.value === botao.dataset.status ? '' : botao.dataset.status;
    void recarregarDoInicio();
  });
}

// ---- equipamentos (filtro e formulário) -------------------------------------------
async function carregarEquipamentos() {
  const equipamentos = await api.get('/equipamentos');
  const filtroEq = $('filtro-equipamento');
  const novaEq = $('nova-equipamento');
  const selecionado = filtroEq.value;
  filtroEq.length = 1; // mantém "Todos"
  novaEq.length = 1;   // mantém "Selecione…"
  preencherSelect(filtroEq, equipamentos.map((e) => [e.id, `${e.tag} — ${e.nome}`]));
  preencherSelect(novaEq, equipamentos.map((e) => [e.id, `${e.tag} — ${e.nome} (${e.status === 'PARADO' ? 'parado' : 'operando'})`]));
  filtroEq.value = selecionado;
}

// ---- lista ------------------------------------------------------------------------
const SKELETON = [
  { tamanho: 'curto' }, { tamanho: 'medio' }, { tamanho: 'longo', coluna: 'col-descricao' }, { tamanho: 'medio' },
  { tamanho: 'curto' }, { tamanho: 'medio' }, { tamanho: 'medio' }, { tamanho: 'medio' },
];

function linhaOs(os) {
  return el('tr', { classe: `prioridade-${classeDe(os.prioridade)}` }, [
    el('td', {}, [el('a', { classe: 'num-os', texto: `#${os.id}`, attrs: { href: `os-detalhe.html?id=${encodeURIComponent(os.id)}` } })]),
    el('td', { classe: 'equip' }, [
      el('span', { classe: 'tag-equip', texto: os.equipamento_tag, attrs: { title: os.equipamento_nome ?? '' } }),
      el('span', { classe: 'nome-equip', texto: os.equipamento_nome }),
    ]),
    el('td', { classe: 'col-descricao' }, [el('span', { classe: 'descricao-curta', texto: os.descricao, attrs: { title: os.descricao ?? '' } })]),
    el('td', { classe: 'curta', texto: ROTULOS_TIPO[os.tipo] ?? os.tipo }),
    el('td', { classe: 'curta' }, [marcaPrioridade(os.prioridade)]),
    el('td', {}, [marcaStatus(os.status)]),
    el('td', {}, [el('span', { classe: 'data', texto: formatarDataHoraCurta(os.aberta_em), attrs: { title: new Date(os.aberta_em).toLocaleString('pt-BR') } })]),
    el('td', { classe: 'curta', texto: os.tecnico_nome ?? '—' }),
  ]);
}

function filtrosAtivos() {
  return [...new FormData(filtros).values()].some(Boolean);
}

async function carregarLista() {
  const parametros = new URLSearchParams();
  for (const [nome, valor] of new FormData(filtros)) if (valor) parametros.set(nome, valor);
  parametros.set('limit', POR_PAGINA);
  parametros.set('offset', offset);
  sincronizarIndicadores();

  limpar(linhas);
  linhas.append(...linhasSkeleton(8, SKELETON));
  linhas.setAttribute('aria-busy', 'true');
  try {
    const { dados, paginacao } = await api.get(`/os?${parametros}`);
    total = paginacao.total;
    limpar(linhas);
    if (!dados.length) {
      const vazio = filtrosAtivos()
        ? estadoVazio({ titulo: 'Nenhuma OS encontrada', texto: 'Nenhuma ordem de serviço corresponde a esses filtros.', acao: { texto: 'Limpar filtros', aoClicar: limparFiltros } })
        : estadoVazio({ titulo: 'Nenhuma OS cadastrada', texto: 'Quando uma ordem de serviço for aberta, ela aparece aqui.' });
      linhas.append(el('tr', {}, [el('td', { attrs: { colspan: 8 } }, [vazio])]));
    }
    for (const os of dados) linhas.append(linhaOs(os));

    const de = total ? offset + 1 : 0;
    const ate = Math.min(offset + POR_PAGINA, total);
    const info = $('info-paginacao');
    limpar(info);
    info.append(el('span', { classe: 'mono', texto: `${de}–${ate}` }), ' de ', el('span', { classe: 'mono', texto: total }), ' ordens');
    $('botao-anterior').disabled = offset === 0;
    $('botao-proxima').disabled = offset + POR_PAGINA >= total;
  } catch (erro) {
    limpar(linhas);
    mensagemDeErro(caixa, erro, 'Não foi possível carregar as OS: ');
  } finally {
    linhas.removeAttribute('aria-busy');
  }
}

function recarregarDoInicio() {
  offset = 0;
  return carregarLista();
}

function limparFiltros() {
  filtros.reset();
  void recarregarDoInicio();
}

// ---- drawer "Nova OS" -------------------------------------------------------------
// A tela só esconde o botão; quem garante a permissão é a API (403 para outros perfis).
const drawer = $('drawer-nova');
const fundo = $('fundo-drawer');
const formNova = $('form-nova');
const caixaNova = $('mensagem-nova');
const botaoNova = $('botao-nova');
botaoNova.hidden = !['OPERADOR', 'SUPERVISOR'].includes(usuario.perfil);

function abrirDrawer() {
  esconderMensagem(caixaNova);
  drawer.inert = false;
  drawer.classList.add('aberto');
  fundo.classList.add('visivel');
  document.body.classList.add('drawer-aberto');
  $('nova-equipamento').focus();
}

function fecharDrawer() {
  drawer.classList.remove('aberto');
  fundo.classList.remove('visivel');
  document.body.classList.remove('drawer-aberto');
  drawer.inert = true; // fora do foco do teclado enquanto fechado
  formNova.reset();
  $('nova-prioridade').value = 'MEDIA';
  botaoNova.focus();
}

botaoNova.addEventListener('click', abrirDrawer);
for (const alvo of document.querySelectorAll('[data-fechar-drawer]')) alvo.addEventListener('click', fecharDrawer);
document.addEventListener('keydown', (evento) => {
  if (!drawer.classList.contains('aberto')) return;
  if (evento.key === 'Escape') fecharDrawer();
  // mantém o Tab dentro do drawer (modal)
  if (evento.key === 'Tab') {
    const focaveis = [...drawer.querySelectorAll('button, select, textarea, input')].filter((e) => !e.disabled);
    const primeiro = focaveis[0];
    const ultimo = focaveis.at(-1);
    if (evento.shiftKey && document.activeElement === primeiro) { evento.preventDefault(); ultimo.focus(); }
    else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primeiro.focus(); }
  }
});

formNova.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixaNova);
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
    mostrarMensagem(caixaNova, 'Confira os campos da OS:', 'erro', problemas);
    return;
  }

  const botao = formNova.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    const os = await api.post('/os', dados);
    fecharDrawer();
    mostrarMensagem(caixa, `OS #${os.id} aberta para ${os.equipamento_tag}. O equipamento agora está PARADO.`, 'sucesso');
    await Promise.all([carregarEquipamentos(), carregarIndicadores(), recarregarDoInicio()]);
  } catch (erro) {
    mensagemDeErro(caixaNova, erro, 'A OS não foi aberta: ');
  } finally {
    botao.disabled = false;
  }
});

// ---- filtros e paginação ----------------------------------------------------------
// carregarLista() trata os próprios erros (mostra a mensagem na tela) e nunca rejeita;
// por isso, nos tratadores de evento, a promessa é ignorada de forma explícita com "void".
filtros.addEventListener('change', () => { void recarregarDoInicio(); });
filtros.addEventListener('submit', (e) => { e.preventDefault(); void recarregarDoInicio(); });
$('botao-limpar').addEventListener('click', limparFiltros);
$('botao-atualizar').addEventListener('click', () => { void carregarIndicadores(); void carregarLista(); });
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

void carregarIndicadores();
try {
  await carregarEquipamentos();
} catch (erro) {
  mensagemDeErro(caixa, erro, 'Não foi possível carregar os equipamentos: ');
}
await carregarLista();
