/**
 * /src/lib/nfce/trabalho-do-danfe.ts
 *
 * O TRABALHO DE IMPRESSÃO do DANFE: o payload do PrintRequest (kind
 * "DANFE_NFCE") que a fila da nuvem entrega ao Assistente de impressão — o
 * contrato com firehub-print-assistant/server.js (buildDanfeEscPos).
 *
 * ── Por que o cupom vai PRONTO, em linhas ────────────────────────────────────
 * A comanda é montada dentro do Assistente. O DANFE não: o leiaute dele é
 * regra fiscal (Manual do DANFE NFC-e) e muda com a lei, e o Assistente das
 * lojas leva semanas para se atualizar (a maioria ficou em versões antigas em
 * set/2026). Com as linhas montadas aqui (danfe.ts, danfeEmTexto), uma
 * correção no cupom vale na mesma hora em toda loja; o Assistente só aplica
 * negrito e altura, imprime o QR (GS ( k; no perfil "legacy", como imagem
 * GS v 0) e corta.
 *
 * ── Uma variante por largura ─────────────────────────────────────────────────
 * Quem decide a largura de verdade é o Assistente (colunas calibradas, ou o
 * que o driver do Windows informa — uma Bematech de 80 mm rende 42 colunas).
 * Então vão as larguras de sempre (32, 42, 48) mais as de cada impressora
 * cadastrada, e ele usa a maior que cabe. Cada variante tem o QR com o módulo
 * certo para aquela largura.
 *
 * ── Vias ─────────────────────────────────────────────────────────────────────
 * Uma; na contingência ainda pendente, duas — "Via do Consumidor" e "Via do
 * Estabelecimento", que fica na loja até a SEFAZ autorizar (Ajuste SINIEF
 * 19/16, cl. 11ª, §3º; Manual 3.1.8). Vão no MESMO trabalho, com corte entre
 * elas, para uma não sair sem a outra.
 *
 * PURO: sem banco. Quem grava na fila é impressao-do-danfe.ts.
 */
import { danfeEmTexto, viasDoDanfe, type DadosDoDanfe, type PecaDoDanfe, type ViaDoDanfe } from "./danfe";

/** Igual a KIND_DANFE_NFCE de lib/print.ts (repetido para este arquivo não puxar o print.ts do navegador). */
export const KIND_DO_TRABALHO = "DANFE_NFCE";

/** 58 mm, Bematech/Elgin de 80 mm em fonte estreita, 80 mm. */
export const LARGURAS_PADRAO = [32, 42, 48];

/**
 * Uma largura do cupom. O QR vai à parte: o Assistente o imprime pelo comando
 * da impressora (GS ( k) ou, no perfil "legacy", como imagem (GS v 0) — e não
 * imprime DANFE sem QR (server.js → buildDanfeEscPos).
 */
export type VarianteDoDanfe = {
  linhas: PecaDoDanfe[];
  qr: { conteudo: string; modulo: number };
};

export type TrabalhoDoDanfe = {
  kind: typeof KIND_DO_TRABALHO;
  danfe: {
    versao: 1;
    /** Chave + estado ("autorizada" | "contingencia"): o mesmo papel não entra duas vezes na fila. */
    identidade: string;
    chave: string;
    pedidoId: string;
    numero: string;
    serie: string;
    pendente: boolean;
    homologacao: boolean;
    vias: Array<{ via: ViaDoDanfe | null; porColunas: Record<string, VarianteDoDanfe> }>;
  };
};

/**
 * As larguras que a loja pode ter: as de sempre e as de cada impressora
 * cadastrada — `columns` calibrado (24 a 64), senão 32 no 58 mm e 48 no 80 mm
 * (a mesma regra de resolveColumns em lib/print.ts).
 */
export function largurasDasImpressoras(printers: unknown): number[] {
  const larguras = new Set<number>(LARGURAS_PADRAO);
  for (const p of Array.isArray(printers) ? printers : []) {
    const c = Number(p?.columns);
    larguras.add(Number.isFinite(c) && c >= 24 && c <= 64 ? Math.floor(c) : p?.paperWidth === "58mm" ? 32 : 48);
  }
  return [...larguras].sort((a, b) => a - b);
}

/** Monta o payload do PrintRequest do DANFE. */
export function trabalhoDoDanfe(dados: DadosDoDanfe, opcoes: { pedidoId: string; larguras?: number[] }): TrabalhoDoDanfe {
  const larguras = [...new Set((opcoes.larguras?.length ? opcoes.larguras : LARGURAS_PADRAO).map((n) => Math.floor(n)))]
    .filter((n) => n >= 24 && n <= 64)
    .sort((a, b) => a - b);
  const vias = viasDoDanfe(dados).map((via) => {
    const porColunas: Record<string, VarianteDoDanfe> = {};
    for (const colunas of larguras) {
      const t = danfeEmTexto(dados, colunas, { via });
      porColunas[String(colunas)] = { linhas: t.linhas, qr: t.qr };
    }
    return { via, porColunas };
  });
  return {
    kind: KIND_DO_TRABALHO,
    danfe: {
      versao: 1,
      identidade: `${dados.chave}:${dados.pendenteDeAutorizacao ? "contingencia" : "autorizada"}`,
      chave: dados.chave,
      pedidoId: opcoes.pedidoId,
      numero: dados.numeroFormatado,
      serie: dados.serieFormatada,
      pendente: dados.pendenteDeAutorizacao,
      homologacao: dados.homologacao,
      vias,
    },
  };
}
