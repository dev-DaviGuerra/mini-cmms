// Erros de negócio com o status HTTP correspondente.
// Os services lançam estes erros; o middleware middlewares/erros.js os converte em resposta.

export class ErroApi extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export class ErroValidacao extends ErroApi {
  constructor(mensagem, detalhes) { super(400, 'VALIDACAO', mensagem, detalhes); }
}

export class ErroNaoAutenticado extends ErroApi {
  constructor(mensagem = 'Autenticação necessária') { super(401, 'NAO_AUTENTICADO', mensagem); }
}

export class ErroProibido extends ErroApi {
  constructor(mensagem = 'Seu perfil não tem permissão para esta ação') {
    super(403, 'PROIBIDO', mensagem);
  }
}

export class ErroNaoEncontrado extends ErroApi {
  constructor(mensagem = 'Recurso não encontrado') { super(404, 'NAO_ENCONTRADO', mensagem); }
}

export class ErroConflito extends ErroApi {
  constructor(codigo, mensagem, detalhes) { super(409, codigo, mensagem, detalhes); }
}
