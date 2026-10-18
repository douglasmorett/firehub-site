/**
 * O ATENDIMENTO É SÓ DO ADMIN (Douglas, 18/10/2026: "o meu vendedor não
 * precisa ter esse painel de atendimento. Pode tirar dele. Só eu.").
 *
 * 1. As regras de lib/crm/acesso.ts: podeVerConversas e semConversa.
 * 2. As rotas que leem/mandam mensagem ou mexem no robô de uma conversa negam o
 *    vendedor com 403 ANTES de tocar no banco (conferência no código de cada
 *    handler), e as que devolvem o contato para o vendedor passam por semConversa.
 * 3. O portal do vendedor/embaixador não tem mais a aba Conversas nem atalho
 *    para abrir o chat.
 *
 *   npx tsx scripts/teste-atendimento-so-do-admin.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const RAIZ = join(__dirname, "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

/** Os handlers exportados de uma rota: { GET: "corpo…", POST: "corpo…" }. */
function handlers(rel: string): Record<string, string> {
  const s = ler(rel);
  const partes = s.split(/export async function /).slice(1);
  return Object.fromEntries(partes.map((p) => [p.slice(0, p.indexOf("(")), p]));
}
/** A trava aparece no handler antes da primeira leitura/escrita no banco ou envio? */
const travaAntesDoBanco = (corpo: string, trava: RegExp) => {
  const t = corpo.search(trava);
  const banco = corpo.search(/prisma\.|enviarTexto\(|gravarMensagem\(|mensagensDoContato\(/);
  return t >= 0 && (banco < 0 || t < banco);
};

async function main() {
  // acesso.ts importa o next-auth; sem segredo ele reclama no import.
  process.env.NEXTAUTH_SECRET ||= "teste";
  const { podeVerConversas, semConversa, SO_O_ADMIN_NO_ATENDIMENTO } = await import("../src/lib/crm/acesso");

  console.log("\n── Regras ──");
  const admin = { tipo: "ADMIN" as const, id: "a1", nome: "Douglas" };
  const vendedor = { tipo: "VENDEDOR" as const, id: "v1", nome: "Rafael" };
  confere("admin vê as conversas", podeVerConversas(admin), true);
  confere("vendedor NÃO vê as conversas", podeVerConversas(vendedor), false);
  confere("sem sessão NÃO vê as conversas", podeVerConversas(null), false);
  const contato = { id: "c1", nome: "Pizzaria", etapa: "NEGOCIANDO", notas: "ligar às 15h", ultimaMensagemTexto: "a impressora não imprime", resumo: "quer o app" };
  confere("admin recebe o contato inteiro", semConversa(contato, admin), contato);
  confere("vendedor recebe o contato sem a última mensagem e sem o resumo do robô", semConversa(contato, vendedor), { ...contato, ultimaMensagemTexto: null, resumo: null });
  confere("…mas com as notas e a etapa", [semConversa(contato, vendedor).notas, semConversa(contato, vendedor).etapa], ["ligar às 15h", "NEGOCIANDO"]);
  confere("a resposta de negação explica", SO_O_ADMIN_NO_ATENDIMENTO.error.includes("administrador"), true);

  console.log("\n── Rotas: 403 para o vendedor antes de tocar no banco ──");
  const TRAVA_403 = /if \(quem && !podeVerConversas\(quem\)\) return NextResponse\.json\(SO_O_ADMIN_NO_ATENDIMENTO, \{ status: 403 \}\)/;
  for (const rel of ["src/app/api/crm/contatos/[id]/mensagens/route.ts", "src/app/api/crm/contatos/[id]/robo/route.ts"]) {
    const h = handlers(rel);
    confere(`${rel} tem handler`, Object.keys(h).length > 0, true);
    for (const [metodo, corpo] of Object.entries(h)) confere(`${rel} ${metodo}: nega o vendedor (403) antes do banco/envio`, travaAntesDoBanco(corpo, TRAVA_403), true);
  }

  const ficha = handlers("src/app/api/crm/contatos/[id]/route.ts");
  confere("contatos/[id] GET: ?desde (o polling do chat) dá 403 ao vendedor", /if \(desde && !veConversas\) return NextResponse\.json\(SO_O_ADMIN_NO_ATENDIMENTO, \{ status: 403 \}\)/.test(ficha.GET), true);
  confere("contatos/[id] GET: a trava do ?desde vem antes de buscar mensagens", ficha.GET.indexOf("!veConversas) return") < ficha.GET.indexOf("crmMensagem.findMany"), true);
  confere("contatos/[id] GET: só busca as mensagens se veConversas", /veConversas \? mensagensDoContato\(/.test(ficha.GET), true);
  confere("contatos/[id] GET: o contato passa por semConversa", /semConversa\(contatoCompleto\(/.test(ficha.GET), true);
  confere("contatos/[id] GET: o vendedor abrir a ficha não zera as não lidas do admin", /if \(veConversas && contato\.naoLidas > 0\)/.test(ficha.GET), true);
  confere("contatos/[id] PATCH: a resposta passa por semConversa", /semConversa\(contatoCompleto\(atualizado/.test(ficha.PATCH), true);
  const lista = handlers("src/app/api/crm/conversas/route.ts");
  confere("conversas GET (a lista do funil): vendedor recebe os contatos via semConversa", /soContatos \? semConversa\(contatoParaLista\(/.test(lista.GET), true);
  confere("contatos POST: a resposta passa por semConversa", /semConversa\(contatoParaLista\(/.test(handlers("src/app/api/crm/contatos/route.ts").POST), true);

  console.log("\n── Linha do tempo do vendedor: só resumo ──");
  confere("a rota do vendedor monta a linha do tempo no modo VENDEDOR", /linhaDoTempoDaLoja\(id, "VENDEDOR"\)/.test(ler("src/app/api/vendedor/carteira/[id]/linha-do-tempo/route.ts")), true);
  confere("no modo VENDEDOR o texto das mensagens nem sai do banco", /\.\.\.\(modo === "ADMIN" \? \{ texto: true \} : \{\}\)/.test(ler("src/lib/perfil-da-loja/linha-do-tempo-no-banco.ts")), true);

  console.log("\n── Portal do vendedor/embaixador ──");
  const portal = ler("src/components/parceiro/PortalDoParceiro.tsx");
  confere("não importa a CaixaDeAtendimento", portal.includes("CaixaDeAtendimento"), false);
  confere("não tem a aba \"conversas\"", /chave: "conversas"/.test(portal) || /aba === "conversas"/.test(portal), false);
  confere("o funil abre sem atalho de conversa", /<FunilDoCrm modo="VENDEDOR" \/>/.test(portal), true);
  confere("a agenda abre sem atalho de conversa", /<AgendaDaEquipe modo="VENDEDOR" \/>/.test(portal), true);
  confere("nenhum aoAbrirConversa no portal", portal.includes("aoAbrirConversa"), false);
  for (const pagina of ["src/app/vendedor/page.tsx", "src/app/embaixador/page.tsx"]) {
    const s = ler(pagina);
    confere(`${pagina} não monta a caixa de atendimento`, s.includes("CaixaDeAtendimento"), false);
  }

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
  process.exit(falhas ? 1 : 0);
}
void main();
