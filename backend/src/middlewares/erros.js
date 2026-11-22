// Tratamento padronizado de erros. Formato de toda resposta de erro:
//   { "erro": { "codigo": "VALIDACAO", "mensagem": "...", "detalhes": ... } }
//
// 400 validação · 401 sem token/token inválido · 403 perfil sem permissão
// 404 não encontrado · 409 estoque insuficiente ou status inválido · 500 inesperado
import { ErroApi, ErroNaoEncontrado } from '../errors.js';

// Troca CR, LF e os separadores de linha Unicode por "_" antes de gravar no log
export function semQuebras(texto) {
  return String(texto).replaceAll(/[\r\n\u2028\u2029]/g, '_');
}

export function rotaNaoEncontrada(req, _res, next) {
  next(new ErroNaoEncontrado(`Rota ${req.method} ${req.path} não encontrada`));
}

// eslint-disable-next-line no-unused-vars -- o Express reconhece o handler de erro pelos 4 parâmetros
export function tratarErros(err, req, res, _next) {
  if (err instanceof ErroApi) {
    return res.status(err.status).json({
      erro: { codigo: err.codigo, mensagem: err.message, detalhes: err.detalhes },
    });
  }

  // JSON malformado no corpo da requisição (gerado pelo express.json)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      erro: { codigo: 'VALIDACAO', mensagem: 'Corpo da requisição não é um JSON válido' },
    });
  }

  // Erro inesperado: registra no servidor, mas não expõe detalhes internos ao cliente.
  // A URL vem do cliente: sem as quebras de linha, ninguém forja linhas falsas no log
  // (log injection, regra Sonar S5145).
  console.error(`[${new Date().toISOString()}] ${semQuebras(req.method)} ${semQuebras(req.originalUrl)}`, err);
  return res.status(500).json({
    erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor' },
  });
}
