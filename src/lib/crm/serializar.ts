import { telefoneParaExibir, linkDoWhatsApp } from "./telefone";

/**
 * O contato no formato das telas (admin e vendedor). Um só lugar para o que
 * sai do servidor: o jid cru e campos internos não vão para o navegador.
 */
export function contatoParaLista(c: any, nomes: Map<string, string>) {
  return {
    id: c.id as string,
    nome: (c.nome as string | null) || null,
    nomeDaLoja: (c.nomeDaLoja as string | null) || null,
    cidade: (c.cidade as string | null) || null,
    telefone: telefoneParaExibir(c.jid && !String(c.jid).includes("@lid") ? c.jid : c.telefone) || null,
    whatsapp: linkDoWhatsApp(c.jid && !String(c.jid).includes("@lid") ? c.jid : c.telefone),
    etapa: c.etapa as string,
    origem: c.origem as string,
    ehLojista: !!c.userId,
    userId: (c.userId as string | null) || null,
    vendedorId: (c.vendedorId as string | null) || null,
    vendedorNome: c.vendedorId ? nomes.get(c.vendedorId) || "—" : null,
    naoLidas: c.naoLidas as number,
    aguardandoHumano: !!c.aguardandoHumanoDesde,
    aguardandoHumanoDesde: c.aguardandoHumanoDesde ? new Date(c.aguardandoHumanoDesde).toISOString() : null,
    roboPausadoAte: c.roboPausadoAte && new Date(c.roboPausadoAte).getTime() > Date.now() ? new Date(c.roboPausadoAte).toISOString() : null,
    roboDesligado: !!c.roboDesligado,
    ultimaMensagemEm: c.ultimaMensagemEm ? new Date(c.ultimaMensagemEm).toISOString() : null,
    ultimaMensagemTexto: (c.ultimaMensagemTexto as string | null) || null,
    ultimaMensagemDe: (c.ultimaMensagemDe as string | null) || null,
    criadoEm: new Date(c.criadoEm).toISOString(),
    vendedorAtribuidoEm: c.vendedorAtribuidoEm ? new Date(c.vendedorAtribuidoEm).toISOString() : null,
    primeiroContatoEm: c.primeiroContatoEm ? new Date(c.primeiroContatoEm).toISOString() : null,
  };
}

export type ContatoDaLista = ReturnType<typeof contatoParaLista>;

export function contatoCompleto(c: any, nomes: Map<string, string>) {
  return {
    ...contatoParaLista(c, nomes),
    email: (c.email as string | null) || null,
    notas: (c.notas as string | null) || null,
    resumo: (c.resumo as string | null) || null,
    motivoPerda: (c.motivoPerda as string | null) || null,
    podeResponder: !!(c.jid || c.telefone),
  };
}

export type ContatoCompleto = ReturnType<typeof contatoCompleto>;

export function mensagemParaTela(m: any) {
  return {
    id: m.id as string,
    direcao: m.direcao as "ENTRADA" | "SAIDA",
    autor: m.autor as string,
    autorNome: (m.autorNome as string | null) || null,
    tipo: m.tipo as string,
    texto: m.texto as string,
    status: m.status as string,
    criadoEm: new Date(m.criadoEm).toISOString(),
  };
}

export type MensagemDaTela = ReturnType<typeof mensagemParaTela>;

export function reuniaoParaTela(r: any, nomes: Map<string, string>, mascarar = false) {
  if (mascarar) {
    return {
      id: r.id as string, vendedorId: r.vendedorId as string, vendedorNome: nomes.get(r.vendedorId) || "—",
      tipo: r.tipo === "BLOQUEIO" ? "BLOQUEIO" : "OCUPADO", titulo: r.tipo === "BLOQUEIO" ? "Bloqueado" : "Ocupado",
      inicio: new Date(r.inicio).toISOString(), fim: new Date(r.fim).toISOString(), status: r.status as string,
      local: null, observacao: null, contato: null, criadoPorNome: null, mascarada: true,
    };
  }
  return {
    id: r.id as string,
    vendedorId: r.vendedorId as string,
    vendedorNome: nomes.get(r.vendedorId) || "—",
    tipo: r.tipo as string,
    titulo: r.titulo as string,
    inicio: new Date(r.inicio).toISOString(),
    fim: new Date(r.fim).toISOString(),
    status: r.status as string,
    local: (r.local as string | null) || null,
    observacao: (r.observacao as string | null) || null,
    contato: r.contato
      ? { id: r.contato.id, nome: r.contato.nome, nomeDaLoja: r.contato.nomeDaLoja, telefone: telefoneParaExibir(r.contato.jid && !String(r.contato.jid).includes("@lid") ? r.contato.jid : r.contato.telefone) || null, etapa: r.contato.etapa }
      : null,
    criadoPorNome: (r.criadoPorNome as string | null) || null,
    mascarada: false,
  };
}

export type ReuniaoDaTela = ReturnType<typeof reuniaoParaTela>;
