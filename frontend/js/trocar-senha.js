// Troca obrigatória da senha temporária (primeiro login do supervisor de uma empresa
// recém-aprovada). Enquanto não trocar, a API só aceita /api/auth/me e /api/auth/senha
// (403 TROCA_SENHA_OBRIGATORIA nas outras rotas).
import { api, usuarioAtual, sair, paginaInicial, marcarSenhaTrocada, ErroApi } from './api.js';
import { mostrarMensagem, esconderMensagem, problemasSenha, TEXTO_POLITICA_SENHA } from './ui.js';

const usuario = usuarioAtual();
if (!usuario) sair();
else if (!usuario.trocarSenha) window.location.replace(paginaInicial(usuario));

const form = document.getElementById('form-senha');
const caixa = document.getElementById('mensagem');
const botao = document.getElementById('botao-salvar');
document.getElementById('politica-senha').textContent = TEXTO_POLITICA_SENHA;
document.getElementById('botao-sair').addEventListener('click', () => sair('saiu'));
if (usuario?.nome) {
  const empresa = usuario.empresaNome ? ` (${usuario.empresaNome})` : '';
  document.getElementById('saudacao').textContent = `Olá, ${usuario.nome}${empresa}. Escolha a sua senha definitiva.`;
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixa);
  const senhaAtual = form.senhaAtual.value;
  const novaSenha = form.novaSenha.value;

  const problemas = [];
  if (!senhaAtual) problemas.push('Informe a senha temporária.');
  problemas.push(...problemasSenha(novaSenha, 'A nova senha'));
  if (novaSenha !== form.confirmacao.value) problemas.push('A confirmação não é igual à nova senha.');
  if (problemas.length) {
    mostrarMensagem(caixa, 'Confira os campos:', 'erro', problemas);
    return;
  }

  botao.disabled = true;
  try {
    await api.post('/auth/senha', { senhaAtual, novaSenha });
    marcarSenhaTrocada();
    window.location.replace(paginaInicial(usuarioAtual()));
  } catch (erro) {
    const detalhes = erro instanceof ErroApi && Array.isArray(erro.detalhes) ? erro.detalhes : null;
    mostrarMensagem(caixa, erro instanceof ErroApi ? erro.mensagem : `Erro inesperado: ${erro.message}`, 'erro', detalhes);
    botao.disabled = false;
  }
});
