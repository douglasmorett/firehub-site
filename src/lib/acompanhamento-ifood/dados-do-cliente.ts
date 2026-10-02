import { prisma } from "@/lib/prisma";
import { lerNumeroBR } from "./regras";

type Dados = {
  lojaId?: string | null;
  nome?: string;
  responsavel?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  ifoodMerchantId?: string | null;
  modelo?: string;
  percentual?: number;
  baseSemanal?: number;
  tetoSemanal?: number | null;
  valorFixoSemanal?: number | null;
  inicioEm?: Date | null;
  status?: string;
  observacoes?: string | null;
};

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null);

/** Número do formulário (pt-BR): undefined = inválido, null = vazio. */
function numero(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return lerNumeroBR(v) ?? undefined;
}

/**
 * Lê e confere o corpo do POST/PATCH do cliente. Com `lojaId`, o que faltar
 * (nome, telefone, cidade) vem da loja do FireHub. Só os campos presentes no
 * corpo entram no resultado — o PATCH não apaga o que não mandou.
 */
export async function lerDadosDoCliente(
  b: Record<string, unknown>,
  criando: boolean,
): Promise<{ dados: Dados } | { erro: string }> {
  const d: Dados = {};

  if ("lojaId" in b) {
    const lojaId = texto(b.lojaId);
    if (lojaId) {
      const loja = await prisma.user.findUnique({
        where: { id: lojaId },
        select: { storeName: true, name: true, email: true, storePhone: true, city: true },
      });
      if (!loja) return { erro: "Loja não encontrada no FireHub." };
      d.lojaId = lojaId;
      if (!texto(b.nome)) d.nome = loja.storeName || loja.name || loja.email;
      if (!texto(b.telefone) && loja.storePhone) d.telefone = loja.storePhone;
      if (!texto(b.cidade) && loja.city) d.cidade = loja.city;
    } else {
      d.lojaId = null;
    }
  }

  if (texto(b.nome)) d.nome = texto(b.nome)!;
  if (criando && !d.nome) return { erro: "Diga o nome da loja." };

  for (const k of ["responsavel", "telefone", "cidade", "ifoodMerchantId", "observacoes"] as const) {
    if (k in b && !(k in d && d[k])) d[k] = k === "observacoes" && typeof b[k] === "string" ? (b[k] as string).trim().slice(0, 5000) || null : texto(b[k]);
  }

  if ("modelo" in b) {
    if (b.modelo !== "PERCENTUAL" && b.modelo !== "FIXO") return { erro: "Modelo de cobrança inválido." };
    d.modelo = b.modelo;
  }
  if ("status" in b) {
    if (!["ATIVO", "PAUSADO", "ENCERRADO"].includes(String(b.status))) return { erro: "Situação inválida." };
    d.status = String(b.status);
  }

  for (const [k, obrigatorio] of [["percentual", true], ["baseSemanal", true], ["tetoSemanal", false], ["valorFixoSemanal", false]] as const) {
    if (!(k in b)) continue;
    const n = numero(b[k]);
    if (n === undefined || (n !== null && n < 0)) return { erro: `Valor inválido em ${k}.` };
    if (n === null && obrigatorio) continue; // vazio num obrigatório: fica o padrão / o que já estava
    (d as any)[k] = n;
  }
  if (d.percentual !== undefined && d.percentual > 100) return { erro: "Percentual acima de 100%." };

  if ("inicioEm" in b) {
    const s = texto(b.inicioEm);
    if (!s) d.inicioEm = null;
    else {
      // "AAAA-MM-DD" do <input type="date">: meio-dia em Brasília, para não virar o dia anterior em UTC.
      const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00-03:00`) : new Date(s);
      if (isNaN(dt.getTime())) return { erro: "Data de início inválida." };
      d.inicioEm = dt;
    }
  }

  return { dados: d };
}
