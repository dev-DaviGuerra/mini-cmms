// Gestão de usuários (só SUPERVISOR): lista, cadastro em drawer e ativar/desativar.
// A tela confere o perfil só para não mostrar o que não funciona; a API responde 403.
import { api, exigirLogin, ErroApi } from './api.js';
import {
  el, limpar, montarLayout, criarDrawer, mostrarMensagem, esconderMensagem, estadoVazio,
  linhasSkeleton, avisar, problemasSenha, preencherSelect, ROTULOS_PERFIL, TEXTO_POLITICA_SENHA,
} from './ui.js';

const usuario = await exigirLogin();
montarLayout(usuario, 'usuarios');

const $ = (id) => document.getElementById(id);
const caixa = $('mensagem');
const linhas = $('linhas');

function erroParaTela(alvo, erro, prefixo = '') {
  if (erro instanceof ErroApi) {
    mostrarMensagem(alvo, prefixo + erro.mensagem, 'erro', Array.isArray(erro.detalhes) ? erro.detalhes : null);
  } else {
    mostrarMensagem(alvo, `${prefixo}Erro inesperado: ${erro.message}`);
  }
}

// ---- lista --------------------------------------------------------------------------
function marcaSituacao(ativo) {
  return el('span', { classe: `status ${ativo ? 'ativo' : 'inativo'}`, texto: ativo ? 'Ativo' : 'Inativo' });
}

function botaoSituacao(u) {
  if (u.id === usuario.id) {
    // o próprio supervisor não pode se desativar (a API responde 409)
    return el('span', {
      classe: 'texto-suave',
      texto: '—',
      attrs: { title: 'Você não pode desativar o seu próprio usuário', 'aria-label': 'Sem ação: você não pode desativar o seu próprio usuário' },
    });
  }
  const botao = el('button', {
    classe: `botao secundario${u.ativo ? ' perigo' : ''}`,
    texto: u.ativo ? 'Desativar' : 'Ativar',
    attrs: { type: 'button', 'aria-label': `${u.ativo ? 'Desativar' : 'Ativar'} ${u.nome}` },
  });
  botao.addEventListener('click', async () => {
    botao.disabled = true;
    esconderMensagem(caixa);
    try {
      const atualizado = await api.patch(`/usuarios/${u.id}/ativo`, { ativo: !u.ativo });
      avisar(atualizado.ativo
        ? `${atualizado.nome} foi reativado(a) e já pode entrar.`
        : `${atualizado.nome} foi desativado(a). As sessões abertas dele(a) deixam de funcionar.`);
      await carregar();
    } catch (erro) {
      erroParaTela(caixa, erro, 'Não foi possível alterar: ');
      botao.disabled = false;
    }
  });
  return botao;
}

function linhaUsuario(u) {
  const nome = el('td', {}, [el('span', { texto: u.nome })]);
  if (u.id === usuario.id) nome.append(el('span', { classe: 'etiqueta', texto: 'você' }));
  return el('tr', { classe: u.ativo ? '' : 'inativo' }, [
    nome,
    el('td', { classe: 'mono', texto: u.email }),
    el('td', { texto: ROTULOS_PERFIL[u.perfil] ?? u.perfil }),
    el('td', {}, [marcaSituacao(u.ativo)]),
    el('td', { classe: 'numero' }, [botaoSituacao(u)]),
  ]);
}

async function carregar() {
  limpar(linhas);
  linhas.append(...linhasSkeleton(5, [{ tamanho: 'medio' }, { tamanho: 'longo' }, { tamanho: 'curto' }, { tamanho: 'curto' }, { tamanho: 'medio' }]));
  linhas.setAttribute('aria-busy', 'true');
  try {
    const lista = await api.get('/usuarios');
    limpar(linhas);
    if (!lista.length) {
      linhas.append(el('tr', {}, [el('td', { attrs: { colspan: 5 } }, [estadoVazio({ titulo: 'Nenhum usuário', texto: 'Cadastre o primeiro usuário.' })])]));
    }
    for (const u of lista) linhas.append(linhaUsuario(u));
    const ativos = lista.filter((u) => u.ativo).length;
    $('contagem').textContent = `${lista.length} usuários · ${ativos} ativos · ${lista.length - ativos} inativos`;
  } catch (erro) {
    limpar(linhas);
    erroParaTela(caixa, erro, 'Não foi possível carregar os usuários: ');
  } finally {
    linhas.removeAttribute('aria-busy');
  }
}

// ---- cadastro em drawer ------------------------------------------------------------
const formUsuario = $('form-usuario');
const caixaUsuario = $('mensagem-usuario');
const drawerUsuario = criarDrawer({
  drawer: $('drawer-usuario'),
  fundo: $('fundo-drawer'),
  botaoOrigem: $('botao-novo'),
  primeiroCampo: $('usuario-nome'),
  aoFechar: () => { formUsuario.reset(); esconderMensagem(caixaUsuario); },
});

$('botao-novo').addEventListener('click', () => drawerUsuario.abrir());

formUsuario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixaUsuario);
  const dados = {
    nome: formUsuario.nome.value.trim(),
    email: formUsuario.email.value.trim(),
    perfil: formUsuario.perfil.value,
    senha: formUsuario.senha.value,
  };

  const problemas = [];
  if (dados.nome.length < 3) problemas.push('Informe o nome (mínimo de 3 caracteres).');
  if (!dados.email.includes('@')) problemas.push('Informe um e-mail válido.');
  if (!dados.perfil) problemas.push('Selecione o perfil.');
  problemas.push(...problemasSenha(dados.senha));
  if (dados.senha !== formUsuario.confirmacao.value) problemas.push('A confirmação não é igual à senha.');
  if (problemas.length) {
    mostrarMensagem(caixaUsuario, 'Confira os campos:', 'erro', problemas);
    return;
  }

  const botao = formUsuario.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    const criado = await api.post('/usuarios', dados);
    drawerUsuario.fechar();
    avisar(`Usuário ${criado.nome} cadastrado como ${ROTULOS_PERFIL[criado.perfil]}.`);
    await carregar();
  } catch (erro) {
    erroParaTela(caixaUsuario, erro, 'O usuário não foi cadastrado: ');
  } finally {
    botao.disabled = false;
  }
});

// ---- início ------------------------------------------------------------------------
if (usuario.perfil === 'SUPERVISOR') {
  $('botao-novo').hidden = false;
  $('secao-lista').hidden = false;
  preencherSelect($('usuario-perfil'), Object.entries(ROTULOS_PERFIL));
  $('politica-senha').textContent = TEXTO_POLITICA_SENHA;
  await carregar();
} else {
  const aviso = estadoVazio({ titulo: 'Acesso restrito', texto: 'A gestão de usuários é exclusiva do perfil Supervisor.' });
  aviso.append(el('a', { classe: 'botao secundario', texto: '← Voltar para as ordens de serviço', attrs: { href: 'os.html' } }));
  $('restrito').append(aviso);
  $('restrito').hidden = false;
}
