/**
 * /material/apresentacao e /material/folder — páginas PÚBLICAS (quem recebe o
 * link não tem login) com o material já personalizado:
 *
 *   ?ref=<código do vendedor/embaixador>   o mesmo do link de cadastro dele
 *   ?indicacao=<código da loja>            o do Indique e ganhe (slug ou id)
 *   &n=<nome>  &w=<whatsapp>  &q=whatsapp|cadastro   o que a pessoa montou na tela
 *   &previa=1  (moldura da tela do material)   &imprimir=1  (abre o "Salvar como PDF")
 *
 * Só sai o que a própria pessoa usa para divulgar: nome, WhatsApp e o link de
 * cadastro. `n` e `w` só valem com um código válido — sem ele, é o material
 * genérico do FireHub.
 */
import { prisma } from "@/lib/prisma";
import { codigoDaIndicacao, contaDaLoja, ENDERECO_DO_CADASTRO, linkDeIndicacao } from "@/lib/indique-e-ganhe";
import { montarMaterial, type Indicador, type Material } from "./personalizar";
import { whatsappValido } from "./telefone";

async function parceiroDoCodigo(bruto: string | null): Promise<Indicador | null> {
  const codigo = String(bruto ?? "").trim();
  if (!codigo || codigo.length > 60 || !/^[A-Za-z0-9_-]+$/.test(codigo)) return null;
  const a = await prisma.ambassador.findFirst({
    where: { code: { equals: codigo, mode: "insensitive" }, active: true },
    select: { name: true, phone: true, code: true },
  });
  if (!a) return null;
  return { nome: a.name, whatsapp: whatsappValido(a.phone), linkDeCadastro: `${ENDERECO_DO_CADASTRO}?ref=${encodeURIComponent(a.code)}` };
}

async function lojaDoCodigo(bruto: string | null): Promise<Indicador | null> {
  const codigo = codigoDaIndicacao(bruto);
  if (!codigo) return null;
  const loja = await prisma.user.findFirst({ where: { OR: [{ slug: codigo }, { id: codigo }] }, select: { id: true, accountGroupId: true } });
  if (!loja) return null;
  // O link é da conta (lib/indique-e-ganhe.ts): filial divulga a loja principal.
  const principal = await prisma.user.findUnique({ where: { id: contaDaLoja(loja) }, select: { id: true, slug: true, storeName: true, storePhone: true } });
  if (!principal?.storeName) return null;
  return { nome: principal.storeName, whatsapp: whatsappValido(principal.storePhone), linkDeCadastro: linkDeIndicacao(principal) };
}

export async function responderMaterial(url: URL, material: Material): Promise<Response> {
  const q = url.searchParams;
  let indicador = q.has("ref") ? await parceiroDoCodigo(q.get("ref")) : q.has("indicacao") ? await lojaDoCodigo(q.get("indicacao")) : null;
  if (indicador) {
    const nome = (q.get("n") ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    // `w` presente e vazio = a pessoa apagou o número na tela: sai sem WhatsApp.
    indicador = { ...indicador, nome: nome || indicador.nome, whatsapp: q.has("w") ? whatsappValido(q.get("w")) : indicador.whatsapp };
  }
  const html = await montarMaterial({
    material,
    indicador,
    qr: q.get("q") === "cadastro" ? "cadastro" : "whatsapp",
    previa: q.get("previa") === "1",
    imprimir: q.get("imprimir") === "1",
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Sempre com os dados de agora (nome e WhatsApp mudam na conta).
      "Cache-Control": "no-store",
    },
  });
}
