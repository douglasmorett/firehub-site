/**
 * O que a tela manda para cadastrar fornecedor e produto, conferido. Puro: a
 * rota usa, o teste confere.
 *
 * O WhatsApp do fornecedor é normalizado igual ao do cliente (lib/telefone.ts):
 * gravado como o WhatsApp exige para RECEBER (55 + DDD + número, com o nono
 * dígito) e, à parte, na forma canônica que o webhook compara — "(22)
 * 99999-8888", "5522999998888" e "22 9999-8888" são o mesmo fornecedor.
 */
import { lerNumeroBr } from "@/lib/cmv/numero";
import { paraEnvioWhatsApp, telefoneCanonico } from "@/lib/telefone";
import { horaValida } from "./agenda";
import { unidadeDeCompra } from "./leitura";

export type FornecedorConferido = {
  nome: string; telefone: string | null; telefoneCanonico: string | null; contato: string | null;
  categorias: string[]; pedidoMinimo: number | null; diasDeEntrega: number[]; prazoEntregaDias: number | null;
  horarioLimite: string | null; pagamento: string | null; observacoes: string | null; ativo: boolean;
};
export type ProdutoConferido = {
  nome: string; categoria: string | null; unidade: string; quantidadePadrao: number | null;
  stockItemId: string | null; fatorDoInsumo: number | null; ativo: boolean;
};

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

const texto = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const numeroPositivo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : lerNumeroBr(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
};

export function conferirFornecedor(c: any): Resultado<FornecedorConferido> {
  const nome = texto(c?.nome, 80);
  if (!nome) return { ok: false, erro: "Dê um nome ao fornecedor." };
  const digitado = String(c?.telefone ?? "").trim();
  let telefone: string | null = null;
  let canonico: string | null = null;
  if (digitado) {
    telefone = paraEnvioWhatsApp(digitado) || null;
    canonico = telefoneCanonico(digitado) || null;
    if (!telefone || !canonico) return { ok: false, erro: `O WhatsApp de ${nome} precisa ter DDD, por exemplo (22) 99999-8888.` };
  }
  const categorias = Array.isArray(c?.categorias)
    ? [...new Set(c.categorias.map((x: unknown) => texto(x, 40)).filter(Boolean) as string[])].slice(0, 20)
    : [];
  const dias = Array.isArray(c?.diasDeEntrega)
    ? ([...new Set(c.diasDeEntrega.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))] as number[]).sort()
    : [];
  const prazo = c?.prazoEntregaDias === null || c?.prazoEntregaDias === undefined || c?.prazoEntregaDias === "" ? null : Math.round(Number(c.prazoEntregaDias));
  if (prazo !== null && (!Number.isFinite(prazo) || prazo < 0 || prazo > 30)) return { ok: false, erro: "O prazo de entrega vai de 0 (no mesmo dia) a 30 dias." };
  const limiteDigitado = String(c?.horarioLimite ?? "").trim();
  const horarioLimite = limiteDigitado ? horaValida(limiteDigitado) : null;
  if (limiteDigitado && !horarioLimite) return { ok: false, erro: "O horário limite é no formato 16:00." };
  return {
    ok: true,
    dados: {
      nome, telefone, telefoneCanonico: canonico, contato: texto(c?.contato, 60), categorias,
      pedidoMinimo: numeroPositivo(c?.pedidoMinimo), diasDeEntrega: dias, prazoEntregaDias: prazo, horarioLimite,
      pagamento: texto(c?.pagamento, 120), observacoes: texto(c?.observacoes, 500), ativo: c?.ativo !== false,
    },
  };
}

export function conferirProduto(c: any): Resultado<ProdutoConferido> {
  const nome = texto(c?.nome, 120);
  if (!nome) return { ok: false, erro: "Dê um nome ao produto." };
  return {
    ok: true,
    dados: {
      nome, categoria: texto(c?.categoria, 60), unidade: unidadeDeCompra(c?.unidade) || "un",
      quantidadePadrao: numeroPositivo(c?.quantidadePadrao), stockItemId: texto(c?.stockItemId, 40),
      fatorDoInsumo: numeroPositivo(c?.fatorDoInsumo), ativo: c?.ativo !== false,
    },
  };
}
