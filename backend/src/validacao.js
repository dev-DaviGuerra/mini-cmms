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

    // Inteiro entre min e max; ausente => padrao (sem padrao, o campo é obrigatório)
    inteiroEntre(valor, campo, min, max, padrao) {
      if (valor === undefined || valor === null || valor === '') {
        if (padrao === undefined) problemas.push(`${campo} é obrigatório`);
        return padrao;
      }
      const n = Number(valor);
      if (!Number.isInteger(n) || n < min || n > max) {
        problemas.push(`${campo} deve ser um inteiro entre ${min} e ${max}`);
        return undefined;
      }
      return n;
    },

    // Número (aceita decimal) entre min e max, obrigatório
    decimalEntre(valor, campo, min, max) {
      if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < min || valor > max) {
        problemas.push(`${campo} deve ser um número entre ${min} e ${max}`);
        return undefined;
      }
      return Math.round(valor * 100) / 100;
    },

    // Lista de peças do fechamento: [{ pecaId, qtd }], opcional (padrão []), até 20 itens,
    // sem peça repetida, qtd inteira de 1 a 1000.
    listaPecas(valor) {
      if (valor === undefined || valor === null) return [];
      if (!Array.isArray(valor) || valor.length > 20) {
        problemas.push('pecas deve ser uma lista de até 20 itens { pecaId, qtd }');
        return undefined;
      }
      const vistos = new Set();
      const lista = [];
      valor.forEach((item, i) => {
        const pecaId = Number(item?.pecaId);
        const qtd = Number(item?.qtd);
        if (!Number.isInteger(pecaId) || pecaId <= 0) problemas.push(`pecas[${i}].pecaId deve ser um inteiro positivo`);
        if (!Number.isInteger(qtd) || qtd < 1 || qtd > 1000) problemas.push(`pecas[${i}].qtd deve ser um inteiro de 1 a 1000`);
        if (vistos.has(pecaId)) problemas.push(`pecas[${i}]: peça ${pecaId} repetida (some as quantidades)`);
        vistos.add(pecaId);
        lista.push({ pecaId, qtd });
      });
      return lista;
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

    // Data opcional no formato AAAA-MM-DD (e que exista no calendário). Ausente => undefined.
    data(valor, campo) {
      if (valor === undefined || valor === null || valor === '') return undefined;
      // mês 13 gera Date inválida (getTime NaN); 30/02 "transborda" para março e a volta
      // para texto não bate com o original
      const d = typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)
        ? new Date(`${valor}T00:00:00Z`) : null;
      const valida = d !== null && !Number.isNaN(d.getTime()) && d.toISOString().startsWith(valor);
      if (!valida) {
        problemas.push(`${campo} deve ser uma data válida no formato AAAA-MM-DD`);
        return undefined;
      }
      return valor;
    },

    // Política de senha: 10+ caracteres, com pelo menos uma letra e um número.
    // Máximo de 72 BYTES: o bcrypt ignora o que passa disso (acentos ocupam 2 bytes em UTF-8).
    senha(valor, campo) {
      if (typeof valor !== 'string') {
        problemas.push(`${campo} é obrigatória`);
        return undefined;
      }
      const antes = problemas.length;
      if (valor.length < 10) problemas.push(`${campo} deve ter pelo menos 10 caracteres`);
      if (Buffer.byteLength(valor, 'utf8') > 72) problemas.push(`${campo} deve ter no máximo 72 bytes`);
      if (!/\p{L}/u.test(valor)) problemas.push(`${campo} deve ter pelo menos uma letra`);
      if (!/\d/.test(valor)) problemas.push(`${campo} deve ter pelo menos um número`);
      return problemas.length === antes ? valor : undefined;
    },

    email(valor, campo) {
      const texto = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
      // validação simples, sem quantificadores aninhados (sem risco de ReDoS)
      const partes = texto.split('@');
      const valido = texto.length <= 150 && partes.length === 2 && partes[0].length > 0
        && partes[1].includes('.') && !partes[1].startsWith('.') && !partes[1].endsWith('.') && !/\s/.test(texto);
      if (!valido) {
        problemas.push(`${campo} deve ser um e-mail válido`);
        return undefined;
      }
      return texto;
    },

    booleano(valor, campo) {
      if (typeof valor !== 'boolean') {
        problemas.push(`${campo} deve ser true ou false`);
        return undefined;
      }
      return valor;
    },

    // Problema que não cabe nos validadores acima (ex.: regra entre dois campos)
    erro(mensagem) {
      problemas.push(mensagem);
    },

    // Lança 400 com todos os problemas encontrados de uma vez
    verificar(mensagem = 'Dados inválidos') {
      if (problemas.length) throw new ErroValidacao(mensagem, problemas);
    },
  };
}
