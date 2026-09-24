/**
 * A mesa e o garçom na comanda do pedido de mesa.
 *
 * ── O que faltava ───────────────────────────────────────────────────────────
 *
 * O topo da comanda de mesa saía "(3) MESA": o número do PEDIDO, e de mesa
 * nenhuma. O número da mesa só viajava no endereço ("Mesa 4"), que o
 * Assistente imprime apenas na entrega, e o garçom nem viajava — ele mora na
 * conta da mesa (TableSession), não no pedido. O dono, com a comanda da Ragnar
 * Burger na mão (24/09/2026): "tem que sair pedido (3), o número da MESA — era
 * a 4 — e o nome do garçom".
 *
 * ── Por que vai DE DOIS JEITOS ──────────────────────────────────────────────
 *
 * Campo novo no papel só sai no Assistente que o conhece (1.2.24), e em
 * 24/09/2026 a loja que mais usa mesa (Pastel da Paulista, 774 pedidos de mesa
 * em 30 dias) estava na 1.2.9. Então, como o pager e o CPF (lib/pager.ts,
 * lib/documento-do-cliente.ts), a mesa e o garçom entram também no NOME do
 * cliente, que toda versão imprime:
 *
 *   "Matheus · Mesa 4 · Garçom Rafaela Cereja"
 *
 * e vão em campo próprio (`mesa`, `garcom`). O Assistente novo põe a mesa no
 * topo — "(3) MESA 4" — e o garçom logo abaixo, e tira do nome o que o site
 * embutiu (semMesaNoNome no server.js dele), senão sairiam duas vezes.
 *
 * Os TRÊS trilhos que imprimem pedido montam o nome aqui, em
 * `nomeDoClienteNaComanda`: a fila da nuvem (api/store/print-queue), a tela de
 * pedidos (StoreOrdersDashboard) e o ouvinte global (GlobalPrintListener). Nome
 * montado em três lugares foi o que já deixou o pager fora do papel quando
 * quem imprimia era o ouvinte global.
 */
import { nomeComPager } from "@/lib/pager";
import { nomeComDocumento } from "@/lib/documento-do-cliente";

/**
 * O pedaço da conta da mesa que a comanda precisa. Vai no `include`/`select`
 * do pedido como `tableSession: MESA_DA_COMANDA` — enxuto de propósito: a fila
 * do Assistente consulta a cada 3 s e o painel a cada 8 s.
 */
export const MESA_DA_COMANDA = {
  select: {
    waiterName: true,
    waiter: { select: { name: true } },
    table: { select: { number: true } },
  },
} as const;

export type PedidoComMesa = {
  deliveryType?: string | null;
  customerAddress?: string | null;
  tableSessionId?: string | null;
  tableSession?: {
    waiterName?: string | null;
    waiter?: { name?: string | null } | null;
    table?: { number?: number | string | null } | null;
  } | null;
};

export type CamposDaMesa = { mesa?: string; garcom?: string };

/** Pedido de mesa: o lançado na conta aberta ou o "Mesa 20" do PDV. */
export function ehPedidoDeMesa(p: PedidoComMesa | null | undefined): boolean {
  if (!p) return false;
  return String(p.deliveryType || "").toUpperCase() === "MESA" || !!p.tableSessionId;
}

/**
 * "4" para a Mesa 4. Da conta aberta quando o pedido tem uma; senão do rótulo
 * "Mesa 4" que o pedido carrega no endereço (é assim que o PDV grava a mesa
 * sem conta, e que todo pedido lançado na conta também grava).
 */
export function numeroDaMesa(p: PedidoComMesa | null | undefined): string {
  if (!p || !ehPedidoDeMesa(p)) return "";
  const daConta = p.tableSession?.table?.number;
  if (daConta != null && String(daConta).trim() !== "") return String(daConta).trim();
  const m = String(p.customerAddress || "").match(/^\s*mesa\s*[:#.\-]*\s*(\d{1,4}[A-Za-z]?)(?![0-9A-Za-z])/i);
  return m ? m[1] : "";
}

/** O garçom da conta da mesa. O cadastro vem antes do nome gravado na abertura. */
export function garcomDaMesa(p: PedidoComMesa | null | undefined): string {
  if (!p || !ehPedidoDeMesa(p)) return "";
  const nome = p.tableSession?.waiter?.name || p.tableSession?.waiterName || "";
  return String(nome).replace(/\s+/g, " ").trim().slice(0, 40);
}

/** Os campos próprios que vão no payload da comanda. Vazio fora da mesa. */
export function camposDaMesaParaImpressao(p: PedidoComMesa | null | undefined): CamposDaMesa {
  const mesa = numeroDaMesa(p);
  const garcom = garcomDaMesa(p);
  return {
    ...(mesa ? { mesa } : {}),
    ...(garcom ? { garcom } : {}),
  };
}

/** O nome já diz a mesa? ("Mesa 4" — a conta aberta sem nome grava assim.) */
function nomeJaDizAMesa(nome: string, mesa: string): boolean {
  const alvo = mesa.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z])mesa\\s*[:#.\\-]*\\s*${alvo}(?![0-9A-Za-z])`, "i").test(nome);
}

/**
 * O nome com a mesa e o garçom embutidos, para o Assistente que ainda não tem
 * linha própria para eles.
 *
 * "Matheus" + mesa 4 + Rafaela  → "Matheus · Mesa 4 · Garçom Rafaela"
 * "Mesa 4"  + mesa 4 + Rafaela  → "Mesa 4 · Garçom Rafaela"  (a mesa não repete)
 * ""        + mesa 4            → "Mesa 4"
 * fora da mesa                  → o nome, intacto
 */
export function nomeComMesa(nome: string | null | undefined, campos: CamposDaMesa): string {
  const base = String(nome || "").trim();
  const partes: string[] = [];
  if (campos.mesa && !nomeJaDizAMesa(base, campos.mesa)) partes.push(`Mesa ${campos.mesa}`);
  if (campos.garcom) partes.push(`Garçom ${campos.garcom}`);
  if (partes.length === 0) return base;
  return [base, ...partes].filter(Boolean).join(" · ");
}

/**
 * O nome do cliente como ele vai para o papel, em QUALQUER trilho.
 *
 * Ordem: nome → mesa e garçom → pager → documento. O documento fica por último
 * porque é do fim do nome que o Assistente 1.2.20+ o retira (nomeSemDocumento
 * no server.js); a mesa e o garçom ele encontra onde estiverem.
 */
export function nomeDoClienteNaComanda(
  pedido: PedidoComMesa & {
    customerName?: string | null;
    pagerNumber?: unknown;
    customerCpfCnpj?: unknown;
  }
): string {
  return nomeComDocumento(
    nomeComPager(nomeComMesa(pedido.customerName, camposDaMesaParaImpressao(pedido)), pedido.pagerNumber),
    pedido.customerCpfCnpj
  );
}
