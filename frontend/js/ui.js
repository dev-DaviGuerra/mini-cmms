// Utilitários de interface. REGRA DE SEGURANÇA: dados vindos da API entram na página só por
// textContent (via el()), nunca por innerHTML. Assim um texto como "<img onerror=...>" gravado
// numa descrição de OS aparece como texto e não é executado (proteção contra XSS).
import { sair } from './api.js';

export function el(tag, opcoes = {}, filhos = []) {
  const elemento = document.createElement(tag);
  if (opcoes.classe) elemento.className = opcoes.classe;
  if (opcoes.texto !== undefined && opcoes.texto !== null) elemento.textContent = String(opcoes.texto);
  for (const [nome, valor] of Object.entries(opcoes.attrs ?? {})) elemento.setAttribute(nome, String(valor));
  for (const filho of filhos) if (filho) elemento.append(filho);
  return elemento;
}

export function limpar(elemento) {
  elemento.replaceChildren();
}

export const ROTULOS_STATUS = Object.freeze({
  ABERTA: 'Aberta',
  EM_ANDAMENTO: 'Em andamento',
  AGUARDANDO_PECA: 'Aguardando peça',
  FECHADA: 'Fechada',
  CANCELADA: 'Cancelada',
});

export const ROTULOS_PRIORIDADE = Object.freeze({
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  EMERGENCIA: 'Emergência',
});

export const ROTULOS_TIPO = Object.freeze({ CORRETIVA: 'Corretiva', PREVENTIVA: 'Preventiva' });

const ROTULOS_PERFIL = Object.freeze({ OPERADOR: 'Operador', TECNICO: 'Técnico', SUPERVISOR: 'Supervisor' });

const classeDe = (valor) => String(valor).toLowerCase().replaceAll('_', '-');

export function badgeStatus(status) {
  return el('span', { classe: `badge status-${classeDe(status)}`, texto: ROTULOS_STATUS[status] ?? status });
}

export function badgePrioridade(prioridade) {
  return el('span', { classe: `badge prioridade-${classeDe(prioridade)}`, texto: ROTULOS_PRIORIDADE[prioridade] ?? prioridade });
}

export function formatarDataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Preenche um <select> com pares [valor, rótulo], mantendo a primeira opção (ex.: "Todos")
export function preencherSelect(select, pares) {
  for (const [valor, rotulo] of pares) select.append(el('option', { texto: rotulo, attrs: { value: valor } }));
}

// Caixa de mensagem (erro/sucesso). detalhes: lista de textos (ex.: problemas de validação)
export function mostrarMensagem(caixa, texto, tipo = 'erro', detalhes = null) {
  limpar(caixa);
  caixa.className = `alerta alerta-${tipo}`;
  caixa.append(el('strong', { texto }));
  if (Array.isArray(detalhes) && detalhes.length) {
    caixa.append(el('ul', {}, detalhes.map((d) => el('li', { texto: d }))));
  }
  caixa.hidden = false;
}

export function esconderMensagem(caixa) {
  caixa.hidden = true;
  limpar(caixa);
}

// Cabeçalho comum: marca, navegação, usuário logado e botão Sair
export function montarCabecalho(usuario, paginaAtual) {
  const links = [['os', 'os.html', 'Ordens de serviço']];

  const nav = el('nav', { classe: 'navegacao', attrs: { 'aria-label': 'Principal' } }, links.map(([id, href, texto]) => el('a', {
    texto,
    classe: id === paginaAtual ? 'ativo' : '',
    attrs: { href, ...(id === paginaAtual ? { 'aria-current': 'page' } : {}) },
  })));

  const botaoSair = el('button', { classe: 'botao fantasma', texto: 'Sair', attrs: { type: 'button' } });
  botaoSair.addEventListener('click', () => sair('saiu'));

  const quem = el('div', { classe: 'usuario' }, [
    el('span', { classe: 'usuario-nome', texto: usuario.nome }),
    el('span', { classe: 'badge perfil', texto: ROTULOS_PERFIL[usuario.perfil] ?? usuario.perfil }),
    botaoSair,
  ]);

  const cabecalho = document.getElementById('cabecalho');
  limpar(cabecalho);
  cabecalho.append(el('a', { classe: 'marca', texto: 'Mini-CMMS', attrs: { href: 'os.html' } }), nav, quem);
}
