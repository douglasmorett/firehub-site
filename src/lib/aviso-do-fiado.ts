/**
 * O aviso de fiado na hora de excluir alguém da equipe (Motoboys, Garçons).
 *
 * O fiado espelha a equipe (lib/fiado-do-motoboy.ts): excluir o membro tira o
 * cadastro dele do fiado. Antes, a tela diz quanto ele ainda deve — para a
 * loja não perder a dívida de vista. Roda no navegador.
 */
const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/** Texto para somar ao confirm() da exclusão; vazio se ele não está no fiado. */
export async function avisoDoFiadoAoExcluir(membroId: string): Promise<string> {
  try {
    const res = await fetch("/api/store/employees");
    if (!res.ok) return "";
    const { employees } = await res.json();
    const doFiado = (employees || []).filter((e: any) => e.active !== false && e.equipe?.membroId === membroId);
    if (doFiado.length === 0) return "";
    const deve = doFiado.reduce((t: number, e: any) => t + (Number(e.currentDebt) || 0), 0);
    return deve > 0.005
      ? `\n\n⚠️ Ainda deve ${reais(deve)} no fiado. Ao excluir, sai também do fiado (o histórico fica guardado).`
      : "\n\nSai também da lista do fiado.";
  } catch {
    return "";
  }
}
