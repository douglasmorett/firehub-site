/**
 * /src/lib/nota-pelo-garcom.ts
 *
 * "Emitir nota fiscal?" no app do garçom na maquininha (Douglas, 13/11/2026).
 *
 * O garçom, ao cobrar a mesa na maquininha, responde Sim/Não. Com Sim, a nota
 * da CONTA da mesa sai assim que a conta fecha — sem passar pela lista de
 * formas da emissão automática nem pelo modo "manual" — e o DANFE vai para a
 * impressora do caixa (a fila de sempre, lib/nfce/impressao-do-danfe). O
 * caixa não precisa achar o pedido.
 *
 * ── Quem liga ───────────────────────────────────────────────────────────────
 * Começa DESLIGADO em toda loja. Só o titular liga (tela Nota Fiscal ›
 * Configurações › "Como a nota é emitida"): fica em `fiscalConfig.notaPeloGarcom`
 * = { ligado, por, em } — quem ligou/desligou e quando. O STAFF é barrado em
 * lib/fiscal-config (CAMPOS_DO_TITULAR), como os outros campos da emissão.
 *
 * ── Uma nota só ─────────────────────────────────────────────────────────────
 * Nada aqui chama a emissão (arquivo puro, sem banco: a tela, a gravação e o
 * teste — scripts/teste-nota-pelo-garcom.ts — usam as mesmas regras). O pedido do garçom fica gravado na cobrança
 * (`dados.emitirNota`), e a emissão da conta (lib/fiscal-automatico →
 * emitirNfceDaMesa), que o fechamento JÁ chama uma vez, lê esse pedido e deixa
 * a nota sair mesmo com a forma fora da lista. Se a loja já emite sozinha
 * naquela forma, é a mesma chamada e a mesma nota: não há segunda emissão. As
 * travas de sempre ("a conta já tem nota", "em processamento") seguem valendo.
 *
 * Nota é da CONTA: cobrança parcial (o resto em dinheiro, ou outra pessoa
 * paga depois) guarda o pedido, e a nota sai quando a conta fecha — pela
 * maquininha ou pelo caixa.
 */
export type NotaPeloGarcom = { ligado: boolean; por: string | null; em: string | null };

const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** O que está gravado em `fiscalConfig.notaPeloGarcom`. Ausente = desligado. */
export function lerNotaPeloGarcom(fiscalConfig: unknown): NotaPeloGarcom {
  const n = objeto(objeto(fiscalConfig).notaPeloGarcom);
  return {
    ligado: n.ligado === true,
    por: typeof n.por === "string" ? n.por : null,
    em: typeof n.em === "string" ? n.em : null,
  };
}

/**
 * O garçom pode pedir a nota? O titular ligou E a loja emite NFC-e. Com a
 * emissão desligada a pergunta não aparece: a resposta "Sim" não daria nota.
 */
export function garcomPodePedirNota(fiscalConfig: unknown): boolean {
  return lerNotaPeloGarcom(fiscalConfig).ligado && objeto(fiscalConfig).enabled === true;
}

/** A recusa da rota de cobrança quando o garçom pede nota e a loja não deixa. */
export function recusaDaNotaPeloGarcom(fiscalConfig: unknown): { status: 403; codigo: string; mensagem: string } | null {
  if (garcomPodePedirNota(fiscalConfig)) return null;
  return lerNotaPeloGarcom(fiscalConfig).ligado
    ? { status: 403, codigo: "NOTA_FISCAL_DESLIGADA", mensagem: "A emissão de nota fiscal está desligada nesta loja. Cobre sem nota." }
    : {
        status: 403,
        codigo: "NOTA_PELO_GARCOM_DESLIGADA",
        mensagem: "O dono da loja não liberou o garçom a pedir a nota fiscal. Cobre sem nota; o caixa emite se precisar.",
      };
}

/**
 * Gravar a escolha do titular: muda só quando o "ligado" muda, e carimba quem
 * e quando. Mandar o mesmo valor de novo não troca o carimbo.
 */
export function gravarEscolhaDoTitular(atual: unknown, ligar: boolean, quem: string | null, agora: Date): NotaPeloGarcom {
  const antes = lerNotaPeloGarcom({ notaPeloGarcom: atual });
  if (antes.ligado === ligar) return antes;
  return { ligado: ligar, por: quem, em: agora.toISOString() };
}

/**
 * O DANFE da nota da conta: com o pedido do garçom ele sai na impressora do
 * caixa mesmo se a loja desligou a impressão automática — foi por isso que o
 * garçom pediu.
 */
export function impressaoDaNotaDaConta(lojaImprime: boolean, pedidaPeloGarcom: boolean): { imprimir: boolean; forcar: boolean } {
  if (lojaImprime) return { imprimir: true, forcar: false };
  return pedidaPeloGarcom ? { imprimir: true, forcar: true } : { imprimir: false, forcar: false };
}
