/**
 * /src/lib/segredos.ts
 *
 * Leitura de credencial de ambiente SEM valor de reserva embutido no código.
 *
 * O repositório tem histórico público, e o padrão que existia era:
 *
 *     const appSecret = process.env.META_APP_SECRET || "310b254fc74098…";
 *
 * Isso publica a credencial para qualquer pessoa que abra o arquivo, e o pior:
 * some com o sintoma. Se a variável some do servidor, nada quebra — o sistema
 * segue rodando com um segredo que o mundo inteiro conhece, e ninguém percebe.
 *
 * Aqui o comportamento é o oposto: falta de credencial falha alto e claro, com
 * o nome da variável que precisa ser configurada.
 *
 * Medido em produção em 23/08/2026: todas as variáveis que tinham reserva no
 * código JÁ estavam configuradas no servidor. As reservas nunca eram usadas —
 * só ficavam expostas.
 */

/** Credencial obrigatória. Lança se não estiver configurada. */
export function segredoObrigatorio(nome: string): string {
  const valor = process.env[nome];
  if (!valor || !valor.trim()) {
    throw new Error(
      `${nome} não está configurada no ambiente. ` +
      `Defina a variável no servidor — não existe valor de reserva no código.`
    );
  }
  return valor.trim();
}

/** Credencial opcional: devolve null em vez de lançar. */
export function segredoOpcional(nome: string): string | null {
  const valor = process.env[nome];
  return valor && valor.trim() ? valor.trim() : null;
}
