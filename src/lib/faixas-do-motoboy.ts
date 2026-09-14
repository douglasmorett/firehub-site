/**
 * Quanto a loja paga ao entregador por FAIXA DE DISTÂNCIA.
 *
 * ── Por que faixa e não R$/km ───────────────────────────────────────────────
 *
 * Ninguém acerta com entregador por regra de três. O combinado real é "até 2 km
 * cinco reais, até 4 km sete" — e era isso que faltava: o cadastro só aceitava
 * um valor por km, que o lojista tinha de converter de cabeça e que dava um
 * número diferente em cada entrega.
 *
 * `perKmRate` continua existindo para quem paga km rodado de verdade. As faixas
 * têm precedência quando cadastradas: quem cadastrou faixa quis faixa.
 *
 * ── A regra da última faixa ─────────────────────────────────────────────────
 *
 * Acima da última faixa vale a última. Devolver "não sei" faria a entrega mais
 * LONGA — a que a loja mais paga — cair na taxa que o cliente pagou, enquanto
 * todas as outras usam o acerto. É o pior lugar possível para um buraco.
 */

export type FaixaDoMotoboy = {
  /** Distância máxima desta faixa, em km. */
  ate: number;
  /** Quanto o entregador recebe por uma entrega dentro dela, em reais. */
  valor: number;
};

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Lê e saneia o que está gravado em `Motoboy.faixasDeKm`. */
export function lerFaixasDoMotoboy(bruto: unknown): FaixaDoMotoboy[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  return lista
    .map((f: any) => ({
      ate: Number(f?.ate ?? f?.km ?? 0),
      valor: Number(f?.valor ?? f?.value ?? 0),
    }))
    .filter((f) => Number.isFinite(f.ate) && f.ate > 0 && Number.isFinite(f.valor) && f.valor >= 0)
    .map((f) => ({ ate: centavos(f.ate), valor: centavos(f.valor) }))
    // Duas faixas na mesma distância dariam dois valores para a mesma entrega;
    // vence a primeira que a loja escreveu.
    .filter((f, i, todas) => todas.findIndex((x) => x.ate === f.ate) === i)
    .sort((a, b) => a.ate - b.ate)
    .slice(0, 20);
}

/**
 * O que o entregador recebe por uma entrega desta distância.
 *
 * `null` = não há faixa cadastrada, ou a distância do pedido é desconhecida —
 * e aí quem responde é o resto do acerto (por entrega, diária, tabela da loja).
 */
export function valorDaFaixa(faixas: FaixaDoMotoboy[], km: number | null | undefined): number | null {
  if (!faixas.length) return null;
  const d = Number(km || 0);
  if (!(d > 0)) return null;
  const faixa = faixas.find((f) => d <= f.ate);
  return faixa ? faixa.valor : faixas[faixas.length - 1].valor;
}

/** O que impede estas faixas de serem salvas, em português para a tela. */
export function problemasDasFaixas(faixas: FaixaDoMotoboy[]): string[] {
  const p: string[] = [];
  const semDistancia = faixas.filter((f) => !(Number(f.ate) > 0));
  if (semDistancia.length) p.push("Toda faixa precisa de uma distância maior que zero.");
  const repetidas = faixas.map((f) => f.ate).filter((n, i, todas) => todas.indexOf(n) !== i);
  if (repetidas.length) {
    p.push(`Tem mais de uma faixa em ${Array.from(new Set(repetidas)).join(" km e em ")} km.`);
  }
  return p;
}

/**
 * A frase de conferência: como as faixas ficam para o lojista ler.
 *
 * Ex.: "até 2 km R$ 5,00 · até 4 km R$ 7,00 · acima de 4 km R$ 7,00"
 */
export function explicarFaixas(faixas: FaixaDoMotoboy[]): string {
  if (!faixas.length) return "";
  const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
  const partes = faixas.map((f) => `até ${f.ate} km ${reais(f.valor)}`);
  const ultima = faixas[faixas.length - 1];
  partes.push(`acima de ${ultima.ate} km ${reais(ultima.valor)}`);
  return partes.join(" · ");
}
