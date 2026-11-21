// Tela de login: envia e-mail e senha, guarda o JWT e vai para a lista de OS.
import { entrar, jaLogado, ErroApi } from './api.js';
import { mostrarMensagem, esconderMensagem } from './ui.js';

if (jaLogado()) window.location.replace('os.html');

const form = document.getElementById('form-login');
const caixa = document.getElementById('mensagem');
const botao = document.getElementById('botao-entrar');

const motivo = new URLSearchParams(window.location.search).get('motivo');
if (motivo === 'expirada') mostrarMensagem(caixa, 'Sua sessão expirou. Entre novamente.', 'aviso');
if (motivo === 'saiu') mostrarMensagem(caixa, 'Você saiu do sistema.', 'info');

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderMensagem(caixa);

  const email = form.email.value.trim();
  const senha = form.senha.value;
  if (!email || !senha) {
    mostrarMensagem(caixa, 'Informe e-mail e senha.');
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Entrando…';
  try {
    await entrar(email, senha);
    window.location.replace('os.html');
  } catch (erro) {
    const texto = erro instanceof ErroApi ? erro.mensagem : 'Erro inesperado ao entrar.';
    mostrarMensagem(caixa, texto, 'erro', erro.detalhes);
    form.senha.value = '';
    form.senha.focus();
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});
