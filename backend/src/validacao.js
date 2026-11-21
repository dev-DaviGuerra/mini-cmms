// Validações simples de entrada. Cada função devolve o valor normalizado ou registra um
// problema na lista; no fim, quem chamou lança ErroValidacao (400) se houver problemas.
import { ErroValidacao } from './errors.js';

export function criarValidador() {
  const problemas = [];

  return {
    inteiroPositivo(valor, campo, { obrigatorio = true } = {}) {
      if (valor === undefined || valor === null || valor === '') {
        if (obrigatorio) problemas.push(`${campo} é obrigatório`);
        return undefined;
      }
      const n = Number(valor);
      if (!Number.isInteger(n) || n <= 0 || n > 2147483647) {
        problemas.push(`${campo} deve ser um inteiro positivo`);
        return undefined;
      }
      return n;
    },

    // Inteiro entre min e max; ausente => padrao
    inteiroEntre(valor, campo, min, max, padrao) {
      if (valor === undefined || valor === null || valor === '') return padrao;
      const n = Number(valor);
      if (!Number.isInteger(n) || n < min || n > max) {
        problemas.push(`${campo} deve ser um inteiro entre ${min} e ${max}`);
        return undefined;
      }
      return n;
    },

    opcao(valor, campo, opcoes, { padrao } = {}) {
      if (valor === undefined || valor === null || valor === '') {
        if (padrao === undefined) problemas.push(`${campo} é obrigatório`);
        return padrao;
      }
      if (!opcoes.includes(valor)) {
        problemas.push(`${campo} deve ser um de: ${opcoes.join(', ')}`);
        return undefined;
      }
      return valor;
    },

    texto(valor, campo, { min = 1, max = 1000 } = {}) {
      if (typeof valor !== 'string' || valor.trim().length < min || valor.trim().length > max) {
        problemas.push(`${campo} deve ter entre ${min} e ${max} caracteres`);
        return undefined;
      }
      return valor.trim();
    },

    // Lança 400 com todos os problemas encontrados de uma vez
    verificar(mensagem = 'Dados inválidos') {
      if (problemas.length) throw new ErroValidacao(mensagem, problemas);
    },
  };
}
