/**
 * RESPOSTAS PRONTAS DA LOJA — o texto e as fotos que a própria loja escreveu,
 * enviados do jeito que ela escreveu.
 *
 * Pedido do Antonio (Pizzaria 17, 12/10/2026, pelo Douglas): "quando o cliente
 * falar de combo, tem que mandar essa foto; quando falar de tamanho, manda as
 * informações completinhas; quando perguntar de rodízio, mandar essas
 * informações; reserva de festa, pedir essas informações e mandar o texto
 * pronto que a gente tem". São textos e imagens que a loja já usava no
 * WhatsApp e que o robô parafraseava errado (ou nem sabia: "quais sabores entram
 * no combo", "Alelo é refeição ou alimentação").
 *
 * Mora em `chatbotConfig.respostasProntas` de cada loja — só quem tem a lista
 * usa; as outras lojas não mudam nada. O modelo vê o assunto e o texto de cada
 * uma e, quando o cliente toca no assunto, escreve [[RESPOSTA_PRONTA:<id>]] na
 * resposta; quem envia o texto e as fotos é o webhook, nunca o modelo. Assim o
 * texto chega idêntico e as fotos chegam de verdade.
 */

export type RespostaPronta = {
  /** Curto, sem espaço: "combos", "tamanhos". É o que vai na marca. */
  id: string;
  /** Quando usar, em português de gente: "o cliente pergunta de combo, promoção…" */
  assunto: string;
  /** O texto da loja, enviado igual. Pode faltar quando a resposta é só foto. */
  texto?: string;
  /** Fotos (URL absoluta ou caminho do site, "/robo/..."), na ordem. */
  imagens?: string[];
  /** Texto que vai DEPOIS das fotos (o aviso abaixo da imagem, a ficha a preencher). */
  textoDepois?: string;
};

/** O que o webhook envia: textos e fotos já resolvidos, na ordem. */
export type EnvioDaRespostaPronta = { id: string; texto: string | null; imagens: string[]; textoDepois: string | null };

const SITE = "https://firehubfood.com.br";
const ID_VALIDO = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A lista válida da loja (o que estiver torto é ignorado, nunca derruba o robô). */
export function lerRespostasProntas(chatbotConfig: unknown): RespostaPronta[] {
  const lista = (chatbotConfig as { respostasProntas?: unknown } | null)?.respostasProntas;
  if (!Array.isArray(lista)) return [];
  const vistas = new Set<string>();
  const saida: RespostaPronta[] = [];
  for (const r of lista.slice(0, 20)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = String(o.id || "").trim().toLowerCase();
    const assunto = String(o.assunto || "").trim();
    const texto = String(o.texto || "").trim();
    const textoDepois = String(o.textoDepois || "").trim();
    const imagens = Array.isArray(o.imagens) ? o.imagens.map((i) => String(i || "").trim()).filter(Boolean).slice(0, 6) : [];
    if (!ID_VALIDO.test(id) || vistas.has(id) || !assunto || (!texto && !imagens.length && !textoDepois)) continue;
    vistas.add(id);
    saida.push({ id, assunto, ...(texto ? { texto } : {}), ...(imagens.length ? { imagens } : {}), ...(textoDepois ? { textoDepois } : {}) });
  }
  return saida;
}

/** O bloco do prompt: quando usar cada uma e o que ela diz (para o modelo não contradizer). */
export function blocoDasRespostasProntas(lista: RespostaPronta[]): string {
  if (!lista.length) return "";
  const itens = lista.map((r) => {
    const conteudo = [r.texto, r.imagens?.length ? `(+ ${r.imagens.length} foto${r.imagens.length > 1 ? "s" : ""})` : "", r.textoDepois]
      .filter(Boolean)
      .join("\n");
    return `• [[RESPOSTA_PRONTA:${r.id}]] — use quando: ${r.assunto}\n  O que o sistema envia:\n  ${conteudo.replace(/\n/g, "\n  ")}`;
  });
  return `
RESPOSTAS PRONTAS DA LOJA (o texto e as fotos oficiais da loja):
Quando o cliente tocar num destes assuntos, escreva a marca da resposta na sua mensagem — o SISTEMA envia o texto e as fotos exatamente como a loja escreveu, logo depois da sua mensagem. Escreva no máximo uma frase curta antes da marca (ex.: "Claro! Te mando aqui 👇"), ou só a marca. NUNCA reescreva, resuma nem copie esse conteúdo você mesmo, e não diga "vou mandar uma foto" sem pôr a marca. Use cada resposta pronta uma vez por assunto na conversa: se o histórico mostra que ela já foi enviada, responda a dúvida nova normalmente, usando as informações dela. O que estiver nelas vale como informação oficial da loja.
${itens.join("\n")}
`;
}

/** Todo o conteúdo, para a régua de "serviço afirmado tem fonte?" (rodízio, festa, espaço kids). */
export function textoDasRespostasProntas(lista: RespostaPronta[]): string {
  return lista.map((r) => [r.assunto, r.texto, r.textoDepois].filter(Boolean).join("\n")).join("\n");
}

const MARCA = /\[\[\s*RESPOSTA[_\s]?PRONTA\s*[:=]\s*([^\]\s]+)\s*\]\]/gi;

/**
 * Tira as marcas do texto do modelo (ANTES da limpeza de markdown, que comeria
 * o "_") e devolve os ids que existem na lista da loja, sem repetir.
 */
export function extrairMarcasDeRespostaPronta(texto: string, lista: RespostaPronta[]): { texto: string; ids: string[] } {
  const validos = new Set(lista.map((r) => r.id));
  const ids: string[] = [];
  const limpo = texto.replace(MARCA, (_, id: string) => {
    const chave = String(id).trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (validos.has(chave) && !ids.includes(chave)) ids.push(chave);
    return "";
  });
  return { texto: limpo, ids };
}

const urlAbsoluta = (u: string) => (/^https?:\/\//i.test(u) ? u : `${SITE}${u.startsWith("/") ? "" : "/"}${u}`);

/**
 * O que o webhook manda, já resolvido. Se o modelo escreveu SÓ a marca (a
 * mensagem dele ficaria vazia), o texto da primeira resposta pronta vira a
 * própria resposta — e não é mandado de novo.
 */
export function envioDasRespostasProntas(
  ids: string[],
  lista: RespostaPronta[],
  respostaDoModelo: string,
): { resposta: string; envios: EnvioDaRespostaPronta[] } {
  const envios: EnvioDaRespostaPronta[] = ids
    .map((id) => lista.find((r) => r.id === id))
    .filter((r): r is RespostaPronta => !!r)
    .map((r) => ({ id: r.id, texto: r.texto || null, imagens: (r.imagens || []).map(urlAbsoluta), textoDepois: r.textoDepois || null }));
  let resposta = respostaDoModelo.trim();
  if (!resposta && envios.length) {
    const primeiro = envios[0];
    if (primeiro.texto) {
      resposta = primeiro.texto;
      primeiro.texto = null;
    } else {
      resposta = "Claro! Te mando aqui 👇";
    }
  }
  return { resposta, envios };
}
