/**
 * O FORNECEDOR ESCREVEU PARA A LOJA — o desvio do webhook do robô.
 *
 * Douglas, 07/11/2026: "Todo fornecedor cadastrado, sempre que ele mandar
 * alguma coisa, a loja dele vai entender que ele é um fornecedor, vai saber
 * qual é pelo número, igual a gente identifica os clientes. E aí vai atualizar
 * o banco de dados."
 *
 * No webhook (api/webhook/whatsapp), ANTES do robô de atendimento: se o número
 * é de um fornecedor cadastrado desta loja e a cotação está ligada, a mensagem
 * não vai para o robô de cliente (que ofereceria cardápio ao atacadista) —
 * vem para cá. Texto com cara de preço, foto do encarte, PDF e áudio são lidos
 * pela IA em segundo plano (o webhook responde ao gateway na hora) e viram
 * linhas de preço casadas com os produtos da loja. O fornecedor recebe um
 * "Recebido, obrigado!" uma vez por rodada; conversa sem preço ("ok", "bom
 * dia") não recebe nada — o lojista vê no celular, é o WhatsApp dele.
 *
 * Quem chama já tirou a equipe do FireHub e o dono da loja (o dono continua
 * dono, mesmo que o número também esteja cadastrado como fornecedor).
 */
import { prisma } from "@/lib/prisma";
import { telefoneCanonico } from "@/lib/telefone";
import { pegarAvisoUnico } from "@/lib/aviso-unico";
import { cotacaoEstaLigada } from "./assinatura";
import { casarProduto } from "./casamento";
import { lerPrecosComIa, type Midia } from "./ia";
import { textoTemPreco } from "./leitura";
import { enviarPelaLoja } from "./fila";
import { TEXTO_DE_RECEBIDO } from "./mensagens";
import { VIDA_DA_RODADA_MS, listaDeTexto } from "./no-banco";

/** Telefones dos fornecedores de cada loja, em memória por um minuto: o webhook pergunta a cada mensagem. */
const CACHE_MS = 60_000;
const cache = new Map<string, { ate: number; porTelefone: Map<string, string> }>();
/** PDF ou foto acima disto não vai à IA (o encarte de 40 páginas em alta). */
const TAMANHO_MAXIMO = 15 * 1024 * 1024;

/** Esquece o cache da loja — a tela chama ao salvar fornecedor. */
export function esquecerFornecedoresDaLoja(franchiseeId: string) {
  cache.delete(franchiseeId);
}

async function fornecedorPeloTelefone(franchiseeId: string, telefone: string): Promise<string | null> {
  const canonico = telefoneCanonico(telefone);
  if (!canonico) return null;
  const agora = Date.now();
  let c = cache.get(franchiseeId);
  if (!c || c.ate < agora) {
    const lista = await prisma.fornecedor.findMany({
      where: { franchiseeId, ativo: true, telefoneCanonico: { not: null } },
      select: { id: true, telefoneCanonico: true },
    });
    c = { ate: agora + CACHE_MS, porTelefone: new Map(lista.map((f) => [f.telefoneCanonico!, f.id])) };
    cache.set(franchiseeId, c);
  }
  return c.porTelefone.get(canonico) || null;
}

export type MensagemDoFornecedor = {
  franchiseeId: string;
  /** O telefone (só dígitos) de quem escreveu. */
  telefone: string;
  texto: string;
  audio?: Midia | null;
  imagem?: Midia | null;
  /** O documento (PDF) da mensagem, se houver, e como baixá-lo. */
  documento?: { mimeType: string; nome: string | null; base64: string | null; baixar: () => Promise<string | null> } | null;
};

/**
 * É fornecedor desta loja com a cotação ligada? Então a mensagem é da cotação:
 * devolve true na hora e lê em segundo plano. Nunca lança — qualquer falha
 * devolve false e a mensagem segue o caminho de sempre.
 */
export async function desviarSeForFornecedor(m: MensagemDoFornecedor): Promise<boolean> {
  try {
    const fornecedorId = await fornecedorPeloTelefone(m.franchiseeId, m.telefone);
    if (!fornecedorId) return false;
    if (!(await cotacaoEstaLigada(m.franchiseeId))) return false;
    void lerMensagemDoFornecedor(fornecedorId, m).catch((err) => console.error("[Cotação] Leitura da mensagem do fornecedor falhou:", err?.message));
    return true;
  } catch (err: any) {
    console.error("[Cotação] Conferência de fornecedor falhou:", err?.message);
    return false;
  }
}

async function lerMensagemDoFornecedor(fornecedorId: string, m: MensagemDoFornecedor) {
  const texto = String(m.texto || "").trim();
  let midia: Midia | null = m.audio || m.imagem || null;
  let tipo: "TEXTO" | "IMAGEM" | "PDF" | "AUDIO" = m.audio ? "AUDIO" : m.imagem ? "IMAGEM" : "TEXTO";
  if (!midia && m.documento) {
    const mime = m.documento.mimeType.toLowerCase();
    if (mime === "application/pdf" || mime.startsWith("image/")) {
      const base64 = m.documento.base64 || (await m.documento.baixar());
      if (base64 && base64.length * 0.75 <= TAMANHO_MAXIMO) {
        midia = { base64, mimeType: mime };
        tipo = mime === "application/pdf" ? "PDF" : "IMAGEM";
      }
    }
  }
  if (midia && midia.base64.length * 0.75 > TAMANHO_MAXIMO) midia = null;

  // A rodada é a do último pedido de preços que saiu para ele, se ainda vale.
  const envio = await prisma.cotacaoEnvio.findFirst({
    where: { fornecedorId, tipo: "PRECOS", status: "ENVIADO", enviadoEm: { gte: new Date(Date.now() - VIDA_DA_RODADA_MS) } },
    orderBy: { enviadoEm: "desc" },
    select: { rodadaId: true },
  });
  const rodadaId = envio?.rodadaId ?? null;

  // Conversa sem preço não gasta IA nem ganha "recebido".
  if (!midia && !textoTemPreco(texto)) {
    if (texto) await prisma.cotacaoResposta.create({ data: { franchiseeId: m.franchiseeId, fornecedorId, rodadaId, tipo, texto: texto.slice(0, 4000), status: "SEM_PRECO" } });
    return;
  }

  const resposta = await prisma.cotacaoResposta.create({
    data: { franchiseeId: m.franchiseeId, fornecedorId, rodadaId, tipo, texto: texto.slice(0, 4000) || null, status: "LENDO" },
  });
  const produtos = await prisma.produtoDeCompra.findMany({ where: { franchiseeId: m.franchiseeId, ativo: true }, select: { id: true, nome: true, apelidos: true } });
  const paraCasar = produtos.map((p) => ({ id: p.id, nome: p.nome, apelidos: listaDeTexto(p.apelidos) }));
  const lido = await lerPrecosComIa(m.franchiseeId, { texto, midia }, produtos.map((p) => p.nome));
  if (!lido) {
    await prisma.cotacaoResposta.update({ where: { id: resposta.id }, data: { status: "FALHOU" } });
    return;
  }

  if (lido.linhas.length) {
    await prisma.cotacaoPreco.createMany({
      data: lido.linhas.map((l) => {
        const c = casarProduto(l.nome, paraCasar);
        return {
          franchiseeId: m.franchiseeId, fornecedorId, respostaId: resposta.id, rodadaId,
          produtoId: c?.produtoId ?? null, nomeLido: l.nome, unidadeLida: l.unidade, preco: l.preco, validade: l.validade,
          confianca: c?.confianca ?? 0, status: c?.certo ? "CONFIRMADO" : c ? "SUGERIDO" : "SEM_PRODUTO",
        };
      }),
    });
  }
  const textoFinal = [texto, lido.transcricao ? `🎤 ${lido.transcricao}` : ""].filter(Boolean).join("\n").slice(0, 4000) || null;
  await prisma.cotacaoResposta.update({
    where: { id: resposta.id },
    data: { status: lido.linhas.length ? "LIDA" : "SEM_PRECO", linhas: lido.linhas.length, texto: textoFinal },
  });
  if (!lido.linhas.length) return;

  // "Recebido, obrigado!" uma vez por rodada (avulso: uma vez a cada 12 h).
  // A trava do banco cobre a foto e o texto que chegam juntos e são lidos ao
  // mesmo tempo: sem ela, os dois mandariam o "recebido".
  const desde = rodadaId ? undefined : new Date(Date.now() - 12 * 60 * 60_000);
  const antes = await prisma.cotacaoResposta.count({
    where: {
      fornecedorId, status: "LIDA", id: { not: resposta.id },
      ...(rodadaId ? { rodadaId } : { rodadaId: null, criadaEm: { gte: desde } }),
    },
  });
  if (antes > 0) return;
  if (!(await pegarAvisoUnico(`cotacao-recebido:${fornecedorId}:${rodadaId || "avulso"}`, rodadaId ? VIDA_DA_RODADA_MS : 12 * 60 * 60_000))) return;
  await enviarPelaLoja(m.franchiseeId, m.telefone, TEXTO_DE_RECEBIDO);
}
