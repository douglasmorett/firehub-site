"use client";

/**
 * /src/components/customer/NaoVerMais.tsx
 *
 * "Não ver mais" — a regra única de como o lojista cala um aviso do painel.
 *
 * Decisão do dono em 18/09/2026: TODO aviso tem que ter a opção de não ver
 * mais. Até aqui cada faixa decidia sozinha: a de impressão tinha um "Dispensar
 * por hoje" que voltava no dia seguinte, e as outras (robô caído, caixa aberto,
 * teste grátis, cobrança) não tinham saída nenhuma — o lojista que já tinha
 * lido e decidido não agir convivia com a faixa para sempre. Faixa que não dá
 * para fechar vira paisagem, e aí nenhuma delas é lida no dia em que importa.
 *
 * ── O QUE "NÃO VER MAIS" CALA: A OCORRÊNCIA, NÃO O ASSUNTO ─────────────────
 *
 * Cada aviso informa a OCORRÊNCIA que está mostrando (a queda das 19:26, a
 * fatura de setembro, a versão 1.2.16 do Assistente). O que fica guardado é
 * essa ocorrência. Enquanto for a mesma, a faixa não volta — nem amanhã, nem
 * depois de recarregar. Quando a ocorrência muda (o robô caiu DE NOVO, chegou
 * OUTRA fatura, saiu versão MAIS NOVA), é um fato novo e o aviso reaparece.
 *
 * Sem isso, "não ver mais" no robô caído de hoje calaria a queda do mês que
 * vem, e a loja voltaria a descobrir pelo cliente reclamando que ninguém
 * respondeu — o motivo de a faixa existir.
 *
 * Aviso sem ocorrência (passa `null`) é calado de vez.
 *
 * ── ONDE FICA GUARDADO ─────────────────────────────────────────────────────
 *
 * No navegador (localStorage), uma chave por aviso, guardando só a última
 * ocorrência calada — não cresce com o tempo. É por aparelho: calar no PC do
 * caixa não cala no celular do dono, que pode querer continuar vendo.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

const PREFIXO = "fh_nao_ver_mais_";
const SEMPRE = "sempre";

/** A ocorrência calada deste aviso, ou null. Nunca lança (storage bloqueado). */
export function lerNaoVerMais(aviso: string): string | null {
  try {
    return localStorage.getItem(PREFIXO + aviso);
  } catch {
    return null;
  }
}

export function gravarNaoVerMais(aviso: string, ocorrencia: string | null | undefined): string {
  const valor = ocorrencia || SEMPRE;
  try {
    localStorage.setItem(PREFIXO + aviso, valor);
  } catch {
    /* storage bloqueado: vale só até recarregar */
  }
  return valor;
}

/**
 * `pronto` fica false até o navegador ser lido: quem desenha antes disso faz a
 * faixa já calada piscar na tela a cada carregamento.
 */
export function useNaoVerMais(aviso: string, ocorrencia: string | null | undefined) {
  const [calada, setCalada] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setCalada(lerNaoVerMais(aviso));
  }, [aviso]);

  const ocultar = useCallback(() => {
    setCalada(gravarNaoVerMais(aviso, ocorrencia));
  }, [aviso, ocorrencia]);

  const pronto = calada !== undefined;
  const oculto = pronto && calada === (ocorrencia || SEMPRE);
  return { pronto, oculto, ocultar };
}

const Contexto = createContext<(() => void) | null>(null);

/**
 * Invólucro para faixa desenhada no SERVIDOR (teste grátis e cobrança, no
 * layout de /store): o servidor não enxerga o navegador, então quem decide se
 * a faixa aparece é este pedaço. O botão vai dentro da faixa, como filho, e
 * acha o "ocultar" pelo contexto.
 */
export function AvisoDispensavel({
  aviso,
  ocorrencia,
  children,
}: {
  aviso: string;
  ocorrencia?: string | null;
  children: React.ReactNode;
}) {
  const { pronto, oculto, ocultar } = useNaoVerMais(aviso, ocorrencia);
  if (!pronto || oculto) return null;
  return <Contexto.Provider value={ocultar}>{children}</Contexto.Provider>;
}

/**
 * O botão, igual em todo aviso. `cor` é a do texto e da borda — cada faixa tem
 * a sua família de cor, e o botão acompanha em vez de brigar com ela.
 */
export function BotaoNaoVerMais({
  onClick,
  cor = "#475569",
  borda,
  compacto = false,
}: {
  onClick?: () => void;
  cor?: string;
  borda?: string;
  /** Para as faixas finas e coloridas do topo (teste grátis, cobrança). */
  compacto?: boolean;
}) {
  const doContexto = useContext(Contexto);
  const acao = onClick || doContexto;
  if (!acao) return null;
  return (
    <button
      type="button"
      // Algumas faixas são um link inteiro (a do robô leva ao QR): o clique no
      // botão não pode navegar.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        acao();
      }}
      title="Esconde este aviso neste aparelho. Se acontecer de novo, ele volta."
      style={{
        background: "none",
        border: `1px solid ${borda || cor}`,
        color: cor,
        borderRadius: compacto ? 8 : 10,
        padding: compacto ? "4px 12px" : "9px 14px",
        fontWeight: 700,
        fontSize: compacto ? "0.76rem" : "0.8rem",
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      Não ver mais
    </button>
  );
}
