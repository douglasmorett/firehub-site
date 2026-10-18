/**
 * A LINHA DO TEMPO DA LOJA — tudo o que o FireHub registra do relacionamento
 * com ela, mais recente primeiro (pedido do Douglas, 18/10/2026): conversas
 * com o WhatsApp do FireHub e o chat do painel (CRM), pedidos de ajuda (o robô
 * "chamou uma pessoa", com o motivo), reuniões da agenda, anotações, mudanças
 * de etapa do funil e de vendedor.
 *
 * Só o que existe no banco (CrmContato ligado à loja por `userId`,
 * CrmMensagem, CrmEvento, AgendaReuniao). Puro: a leitura mora em
 * linha-do-tempo-no-banco.ts. Testado em scripts/teste-linha-do-tempo.ts.
 *
 * VENDEDOR × ADMIN (Douglas: "o meu vendedor não precisa ter esse painel de
 * atendimento… Só eu"): o vendedor vê RESUMOS — último atendimento (quem,
 * quando, canal), o que a loja reportou, quantas mensagens — e nunca o texto do
 * chat. O admin vê cada mensagem.
 */

export type TipoNaLinhaDoTempo = "CONVERSA" | "AJUDA" | "REUNIAO" | "NOTA" | "ETAPA" | "VENDEDOR" | "CADASTRO" | "ROBO";

export const ROTULO_DO_TIPO: Record<TipoNaLinhaDoTempo, string> = {
  CONVERSA: "Conversas", AJUDA: "Pedidos de ajuda", REUNIAO: "Reuniões", NOTA: "Anotações", ETAPA: "Funil",
  VENDEDOR: "Vendedor", CADASTRO: "Cadastro", ROBO: "Robô",
};

export type Canal = "WHATSAPP" | "PAINEL";

export type ItemDaLinhaDoTempo = {
  id: string;
  tipo: TipoNaLinhaDoTempo;
  em: string;
  titulo: string;
  texto: string | null;
  autor: string | null;
  canal: Canal | null;
  /** Conversa: de quem é (ENTRADA = a loja escreveu; SAIDA = o FireHub respondeu). */
  direcao?: "ENTRADA" | "SAIDA";
  /** Resumo de conversa do dia (vendedor): quantas mensagens. */
  mensagens?: { daLoja: number; doFireHub: number };
};

export type EntradaDaLinhaDoTempo = {
  contatos: { id: string; nome: string | null; notas: string | null; aguardandoHumanoDesde: string | null; atualizadoEm: string }[];
  mensagens: { id: string; contatoId: string; direcao: string; autor: string; autorNome: string | null; texto: string | null; tipo: string | null; canal: string | null; status: string | null; criadoEm: string }[];
  eventos: { id: string; contatoId: string; tipo: string; texto: string; autorNome: string | null; autorTipo: string | null; criadoEm: string }[];
  reunioes: { id: string; tipo: string; titulo: string | null; inicio: string; status: string; observacao: string | null; vendedor: string | null }[];
  /** User.vendedorAtendidoEm: quando o vendedor marcou "atendido" na carteira. */
  marcadoAtendidoEm: string | null;
  vendedorDaLoja: string | null;
};

export type LinhaDoTempo = {
  modo: "ADMIN" | "VENDEDOR";
  ultimoAtendimento: { em: string; por: string; canal: Canal | null } | null;
  marcadoAtendidoEm: string | null;
  vendedorDaLoja: string | null;
  /** Pedido de ajuda esperando uma pessoa agora (CrmContato.aguardandoHumanoDesde). */
  ajudaAberta: { desde: string } | null;
  conversas: { total: number; daLoja: number; doFireHub: number; ultimaEm: string | null; peloPainel: number };
  /** O que a loja reportou (motivos dos pedidos de ajuda), o mais recente primeiro. */
  reportou: { em: string; motivo: string }[];
  contagem: Record<TipoNaLinhaDoTempo, number>;
  itens: ItemDaLinhaDoTempo[];
  semContato: boolean;
  naoRegistrado: string[];
};

const HUMANOS = new Set(["VENDEDOR", "ADMIN", "CELULAR"]);
const PREFIXO_DA_AJUDA = "Chamou uma pessoa";

const canalDe = (c: string | null | undefined): Canal | null => (c === "PAINEL" ? "PAINEL" : c ? "WHATSAPP" : "WHATSAPP");
const dia = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return p;
};
const quemAtendeu = (m: { autor: string; autorNome: string | null }) =>
  m.autorNome || (m.autor === "CELULAR" ? "Equipe (celular do FireHub)" : m.autor === "ADMIN" ? "Admin" : "Vendedor");

export const NAO_REGISTRADO = [
  "Ligações e conversas fora do WhatsApp do FireHub e do chat do painel não ficam registradas.",
  "Não existe chamado de suporte separado: o pedido de ajuda é quando o robô chamou uma pessoa — o motivo é o que a loja reportou.",
  "Mensagem respondida pelo celular do FireHub aparece como \"Equipe\", sem o nome de quem digitou.",
];

/** Monta a linha do tempo. `modo` VENDEDOR troca cada mensagem por um resumo por dia, sem o texto. */
export function montarLinhaDoTempo(e: EntradaDaLinhaDoTempo, modo: "ADMIN" | "VENDEDOR"): LinhaDoTempo {
  const itens: ItemDaLinhaDoTempo[] = [];
  const msgs = [...e.mensagens].filter((m) => m.status !== "FALHOU").sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));

  // Último atendimento humano (resposta de vendedor, admin ou do celular do FireHub).
  const humana = msgs.find((m) => m.direcao === "SAIDA" && HUMANOS.has(m.autor));
  const ultimoAtendimento = humana ? { em: humana.criadoEm, por: quemAtendeu(humana), canal: canalDe(humana.canal) } : null;

  // Conversas
  if (modo === "ADMIN") {
    for (const m of msgs) {
      const daLoja = m.direcao === "ENTRADA";
      itens.push({
        id: `m:${m.id}`, tipo: "CONVERSA", em: m.criadoEm, direcao: daLoja ? "ENTRADA" : "SAIDA", canal: canalDe(m.canal),
        titulo: daLoja ? "A loja escreveu" : HUMANOS.has(m.autor) ? `${quemAtendeu(m)} respondeu` : m.autor === "ROBO" ? "O robô respondeu" : "FireHub enviou",
        texto: m.texto ? (m.texto.length > 600 ? `${m.texto.slice(0, 600)}…` : m.texto) : m.tipo && m.tipo !== "texto" ? `[${m.tipo}]` : null,
        autor: daLoja ? null : quemAtendeu(m),
      });
    }
  } else {
    // Um resumo por dia e canal: quantas mensagens, quem atendeu — sem o texto.
    const porDia = new Map<string, { em: string; canal: Canal | null; daLoja: number; doFireHub: number; humanos: Set<string> }>();
    for (const m of msgs) {
      const chave = `${dia(m.criadoEm)}|${canalDe(m.canal)}`;
      const g = porDia.get(chave) || { em: m.criadoEm, canal: canalDe(m.canal), daLoja: 0, doFireHub: 0, humanos: new Set<string>() };
      if (m.direcao === "ENTRADA") g.daLoja++; else g.doFireHub++;
      if (m.direcao === "SAIDA" && HUMANOS.has(m.autor)) g.humanos.add(quemAtendeu(m));
      if (m.criadoEm > g.em) g.em = m.criadoEm;
      porDia.set(chave, g);
    }
    for (const [chave, g] of porDia) {
      const quem = [...g.humanos];
      itens.push({
        id: `d:${chave}`, tipo: "CONVERSA", em: g.em, canal: g.canal, mensagens: { daLoja: g.daLoja, doFireHub: g.doFireHub },
        titulo: `Conversa ${g.canal === "PAINEL" ? "no chat do painel" : "no WhatsApp do FireHub"}`,
        texto: `${g.daLoja} ${g.daLoja === 1 ? "mensagem" : "mensagens"} da loja, ${g.doFireHub} do FireHub${quem.length ? ` · atendeu: ${quem.join(", ")}` : " · só o robô respondeu"}.`,
        autor: quem[0] ?? null,
      });
    }
  }

  // Eventos do CRM
  const reportou: { em: string; motivo: string }[] = [];
  for (const ev of e.eventos) {
    const ajuda = ev.tipo === "ROBO" && ev.texto.startsWith(PREFIXO_DA_AJUDA);
    const tipo: TipoNaLinhaDoTempo = ajuda ? "AJUDA"
      : ev.tipo === "NOTA" ? "NOTA" : ev.tipo === "ETAPA" ? "ETAPA" : ev.tipo === "VENDEDOR" ? "VENDEDOR"
      : ev.tipo === "REUNIAO" ? "REUNIAO" : ev.tipo === "CADASTRO" ? "CADASTRO" : "ROBO";
    // A reunião vem da agenda (abaixo); o evento de "marcada" seria repetido.
    if (tipo === "REUNIAO") continue;
    const motivo = ajuda ? ev.texto.replace(/^Chamou uma pessoa:?\s*/, "").trim() : null;
    if (ajuda && motivo) reportou.push({ em: ev.criadoEm, motivo });
    itens.push({
      id: `e:${ev.id}`, tipo, em: ev.criadoEm, canal: null,
      titulo: ajuda ? "Pediu ajuda de uma pessoa" : tipo === "NOTA" ? "Anotação" : tipo === "ETAPA" ? "Mudou de etapa no funil" : tipo === "VENDEDOR" ? "Troca de vendedor" : tipo === "CADASTRO" ? "Cadastro" : "Robô",
      texto: ajuda ? (motivo ? `Reportou: ${motivo}` : null) : ev.texto,
      autor: ev.autorNome,
    });
  }

  // Reuniões da agenda
  for (const r of e.reunioes) {
    const rot = r.tipo === "DEMONSTRACAO" ? "Demonstração" : r.tipo === "TREINAMENTO" ? "Treinamento" : r.tipo === "ACOMPANHAMENTO" ? "Acompanhamento" : "Reunião";
    const st = r.status === "REALIZADA" ? "realizada" : r.status === "FALTOU" ? "a loja faltou" : r.status === "CANCELADA" ? "cancelada" : "marcada";
    itens.push({ id: `r:${r.id}`, tipo: "REUNIAO", em: r.inicio, canal: null, titulo: `${rot} ${st}`, texto: [r.titulo, r.observacao].filter(Boolean).join(" — ") || null, autor: r.vendedor });
  }

  // As notas soltas da ficha do contato (campo de texto, sem data própria).
  for (const c of e.contatos) {
    if (c.notas && c.notas.trim()) itens.push({ id: `n:${c.id}`, tipo: "NOTA", em: c.atualizadoEm, canal: null, titulo: "Notas da ficha do contato", texto: c.notas.trim(), autor: null });
  }

  itens.sort((a, b) => b.em.localeCompare(a.em) || a.id.localeCompare(b.id));
  const contagem: Record<TipoNaLinhaDoTempo, number> = { CONVERSA: 0, AJUDA: 0, REUNIAO: 0, NOTA: 0, ETAPA: 0, VENDEDOR: 0, CADASTRO: 0, ROBO: 0 };
  for (const i of itens) contagem[i.tipo]++;
  const abertas = e.contatos.map((c) => c.aguardandoHumanoDesde).filter(Boolean).sort() as string[];

  return {
    modo,
    ultimoAtendimento,
    marcadoAtendidoEm: e.marcadoAtendidoEm,
    vendedorDaLoja: e.vendedorDaLoja,
    ajudaAberta: abertas.length ? { desde: abertas[0] } : null,
    conversas: {
      total: msgs.length,
      daLoja: msgs.filter((m) => m.direcao === "ENTRADA").length,
      doFireHub: msgs.filter((m) => m.direcao !== "ENTRADA").length,
      ultimaEm: msgs[0]?.criadoEm ?? null,
      peloPainel: msgs.filter((m) => m.canal === "PAINEL").length,
    },
    reportou: reportou.sort((a, b) => b.em.localeCompare(a.em)),
    contagem,
    itens,
    semContato: e.contatos.length === 0,
    naoRegistrado: NAO_REGISTRADO,
  };
}
