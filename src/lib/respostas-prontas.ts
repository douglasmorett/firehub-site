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
  /**
   * Esta resposta leva uma FICHA para o cliente preencher, e a ficha preenchida
   * vai para a equipe: é o nome do que ela pede ("Reserva de festa"). Com isto,
   * quando o cliente devolve os dados, o robô passa a conversa para a equipe com
   * os dados no aviso (Pizzaria 17, 12/10/2026: "a pessoa preencheu tudo, chama
   * a loja: tem uma reserva aqui"). Quem confirma é sempre a equipe.
   */
  fichaParaALoja?: string;
};

/** O que o webhook envia: textos e fotos já resolvidos, na ordem. */
export type EnvioDaRespostaPronta = { id: string; texto: string | null; imagens: string[]; textoDepois: string | null };

/** A ficha que o cliente devolveu preenchida, para o aviso à equipe. */
export type FichaPreenchida = { id: string; titulo: string; dados: string };

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
    const fichaParaALoja = String(o.fichaParaALoja || "").trim().slice(0, 60);
    if (!ID_VALIDO.test(id) || vistas.has(id) || !assunto || (!texto && !imagens.length && !textoDepois)) continue;
    vistas.add(id);
    saida.push({
      id, assunto,
      ...(texto ? { texto } : {}), ...(imagens.length ? { imagens } : {}), ...(textoDepois ? { textoDepois } : {}),
      ...(fichaParaALoja ? { fichaParaALoja } : {}),
    });
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
  const comFicha = lista.filter((r) => r.fichaParaALoja);
  const fichas = comFicha.length
    ? `
FICHA PREENCHIDA VAI PARA A EQUIPE (${comFicha.map((r) => `"${r.id}" = ${r.fichaParaALoja}`).join("; ")}):
Essas respostas levam uma ficha para o cliente preencher. Pediu o que a ficha atende (reserva de mesa, aniversário, festa, grupo)? Mande a resposta pronta e espere a ficha: NÃO chame a equipe antes de ele preencher, salvo se pedir uma pessoa. Quando ele devolver a ficha preenchida (numa mensagem só ou aos poucos, olhe o histórico), confira se vieram pelo menos o nome, a data e a quantidade de pessoas: faltou algum desses, peça só o que falta. Com eles, responda em uma frase que recebeu tudo e que a equipe vai confirmar por aqui mesmo (ex.: "Recebi tudo! 😊 Já passei para a equipe, eles confirmam com você por aqui."), e escreva no fim a marca com o que ele preencheu, campo por campo, numa linha só:
[[FICHA_PARA_A_LOJA:<id>| Nome: ... ; Telefone: ... ; Pessoas: ... ; Data: ... ; Horário: ... ; (os outros campos da ficha que ele respondeu)]]
NUNCA confirme, garanta ou reserve você mesmo: quem confirma é a equipe. Não invente campo que o cliente não respondeu.
`
    : "";
  return `
RESPOSTAS PRONTAS DA LOJA (o texto e as fotos oficiais da loja):
Quando o cliente tocar num destes assuntos, escreva a marca da resposta na sua mensagem — o SISTEMA envia o texto e as fotos exatamente como a loja escreveu, logo depois da sua mensagem. Escreva no máximo uma frase curta antes da marca (ex.: "Claro! Te mando aqui 👇"), ou só a marca. NUNCA reescreva, resuma nem copie esse conteúdo você mesmo, e não diga "vou mandar uma foto" sem pôr a marca. Use cada resposta pronta uma vez por assunto na conversa: se o histórico mostra que ela já foi enviada, responda a dúvida nova normalmente, usando as informações dela. O que estiver nelas vale como informação oficial da loja.
${itens.join("\n")}
${fichas}`;
}

/**
 * A linha "reserva" das regras do robô quando a loja tem uma ficha de reserva
 * pronta: no lugar do "me diz dia, horário e pessoas que eu chamo a equipe",
 * vão as regras e a ficha da loja. "" quando não tem.
 */
export function regraDaReservaPelaFicha(lista: RespostaPronta[]): string {
  const r = lista.find((x) => x.fichaParaALoja && /reserv/i.test(`${x.id} ${x.fichaParaALoja}`));
  return r ? `\n   - RESERVA (mesa, festa, grupo): [[RESPOSTA_PRONTA:${r.id}]] e siga "FICHA PREENCHIDA".` : "";
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

const MARCA_DA_FICHA = /\[\[\s*FICHA[_\s]?PARA[_\s]?A[_\s]?LOJA\s*[:=]\s*([a-z0-9-]+)\s*\|?([\s\S]*?)\]\]/gi;

/**
 * Tira a marca da ficha preenchida do texto do modelo (ANTES da limpeza de
 * markdown) e devolve a primeira que é de uma resposta com ficha desta loja.
 * Marca de id desconhecido some do texto e não chama ninguém.
 */
export function extrairFichaPreenchida(texto: string, lista: RespostaPronta[]): { texto: string; ficha: FichaPreenchida | null } {
  let ficha: FichaPreenchida | null = null;
  const limpo = texto.replace(MARCA_DA_FICHA, (_, id: string, dados: string) => {
    const r = lista.find((x) => x.id === String(id).trim().toLowerCase());
    if (!ficha && r?.fichaParaALoja) {
      const linhas = String(dados || "")
        .split(/\s*;\s*|\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 15);
      ficha = { id: r.id, titulo: r.fichaParaALoja, dados: linhas.join("\n").slice(0, 1200) };
    }
    return "";
  });
  return { texto: limpo, ficha };
}

/** O aviso que vai para o WhatsApp do dono com a ficha. */
export function textoDoAvisoDaFicha(ficha: FichaPreenchida, cliente: { nome: string; telefone: string }): string {
  const tel = cliente.telefone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  return [
    `📋 *${ficha.titulo}: para a equipe confirmar*`,
    ``,
    `Cliente: ${cliente.nome}${tel ? ` (${tel})` : ""}`,
    ficha.dados || "(o cliente não detalhou; veja a conversa)",
    ``,
    `O robô disse ao cliente que a equipe confirma por lá e passou a conversa para vocês: respondam pelo WhatsApp da loja ou pelo painel.`,
  ].join("\n");
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
