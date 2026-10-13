/**
 * O "De / Até" do quadro de Pedidos nunca pode ficar invertido.
 *
 * O padrão é o dia de operação (05:00 → 04:59 do dia seguinte). Quem troca só
 * a DATA dos dois campos para "12/10" fica com De 12/10 05:00 e Até 12/10 04:59:
 * o Até antes do De, a janela vazia e a coluna Finalizado com 0 — o pedido de
 * ontem "some" (Delícias de Casa, 13/10/2026: #64 Caio Barbara, iFood 9028).
 *
 * Os valores são os do <input type="datetime-local">: "AAAA-MM-DDTHH:mm",
 * comparáveis como texto.
 */

const somarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Fim do dia de operação em que `momento` cai (o dia vira às 5h). */
export function fimDoDiaDeOperacao(momento: string): string {
  const dia = momento.slice(0, 10);
  const hora = momento.slice(11, 16);
  const diaDeOperacao = hora < "05:00" ? somarDias(dia, -1) : dia;
  return `${somarDias(diaDeOperacao, 1)}T04:59`;
}

/**
 * Devolve o período corrigido depois que a loja mexeu em um dos campos.
 * Período válido volta como veio.
 */
export function corrigirPeriodo(de: string, ate: string, mexeu: "de" | "ate"): { de: string; ate: string } {
  if (!de || !ate || de < ate) return { de, ate };
  if (mexeu === "ate") {
    // Trocou a data do Até e o horário ficou na madrugada ("12/10 04:59"):
    // é o fim do dia 12, que termina às 04:59 do dia 13.
    const hora = ate.slice(11, 16);
    if (hora < "05:00") {
      const seguinte = `${somarDias(ate.slice(0, 10), 1)}T${hora}`;
      if (de < seguinte) return { de, ate: seguinte };
    }
  }
  return { de, ate: fimDoDiaDeOperacao(de) };
}
