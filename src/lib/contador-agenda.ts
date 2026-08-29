/**
 * /src/lib/contador-agenda.ts
 *
 * QUANDO o pacote fiscal sai e QUE PERÍODO ele cobre.
 *
 * Fica separado do envio de propósito: é lógica de calendário pura, sem banco e
 * sem e-mail, e é justamente a parte onde um erro passa despercebido por um mês
 * inteiro. "Todo dia 31" que pula fevereiro, ou o pacote de 1º de janeiro
 * pedindo o mês 0 do ano — nada disso dá erro na tela, só um contador que não
 * recebe nada e ninguém descobre. Separado, dá para testar de verdade.
 */
import type { ConfigDoContador } from "@/app/api/store/fiscal/contador/route";


export const FUSO_PADRAO = "America/Sao_Paulo";

/** O dia de hoje no fuso da loja, decomposto. */
export function hojeNaLoja(fuso: string, agora: Date = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(agora);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const ano = get("year");
  const mes = get("month");
  const dia = get("day");
  // Dia 0 do mês seguinte = último dia deste mês. Vale para fevereiro e para
  // ano bissexto sem tabela nenhuma.
  const ultimoDiaDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    ano, mes, dia, ultimoDiaDoMes,
    iso: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
  };
}

/**
 * Hoje é dia de mandar?
 *
 * "Quando o mês fechar" e "todo dia 1º" são a mesma data no calendário — o mês
 * só está fechado depois de virar. Ter as duas opções na tela é escolha
 * deliberada: o lojista pensa nos dois jeitos, e obrigá-lo a traduzir "fecha o
 * mês" para "dia 1º" é o tipo de detalhe que faz ele desistir da tela.
 */
export function devoEnviarHoje(cfg: ConfigDoContador, hoje: ReturnType<typeof hojeNaLoja>): boolean {
  if (!cfg.automatico || !cfg.email) return false;
  switch (cfg.quando) {
    case "DIA_1":
      return hoje.dia === 1;
    case "ULTIMO_DIA":
      return hoje.dia === hoje.ultimoDiaDoMes;
    case "DIA_FIXO":
      // O dia é limitado a 28 na gravação justamente para nunca cair num mês
      // que não tem aquele dia e o envio sumir sem ninguém perceber.
      return hoje.dia === Math.min(28, Math.max(1, cfg.dia));
    case "DATA_CERTA":
      return cfg.data === hoje.iso;
    default:
      return false;
  }
}

/**
 * Que período o pacote cobre.
 *
 * DIA_1 e dia fixo mandam o MÊS ANTERIOR inteiro — é o mês que acabou de
 * fechar. ULTIMO_DIA e data marcada mandam o mês CORRENTE até hoje: quem
 * escolheu o último dia quer o mês que está terminando, não o de trás.
 */
export function periodoDoEnvio(cfg: ConfigDoContador, hoje: ReturnType<typeof hojeNaLoja>) {
  const dd = (n: number) => String(n).padStart(2, "0");

  if (cfg.quando === "DIA_1" || cfg.quando === "DIA_FIXO") {
    const ano = hoje.mes === 1 ? hoje.ano - 1 : hoje.ano;
    const mes = hoje.mes === 1 ? 12 : hoje.mes - 1;
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return { de: `${ano}-${dd(mes)}-01`, ate: `${ano}-${dd(mes)}-${dd(ultimo)}` };
  }

  return { de: `${hoje.ano}-${dd(hoje.mes)}-01`, ate: hoje.iso };
}
