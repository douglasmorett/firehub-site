"use client";

import { useEffect } from "react";

/**
 * O medidor da página de venda: quem chegou, quanto tempo ficou, até onde
 * rolou e no que clicou.
 *
 * Existe porque o pixel do Meta responde uma pergunta só ("quantos cliques
 * viraram checkout") e mistura o domínio inteiro. Com isto dá para saber se
 * a pessoa parou no preço, se abriu a calculadora, se leu até o fim — que é
 * o que diz ONDE a página perde gente.
 *
 * ── Como o tempo é contado ────────────────────────────────────────────────
 * Só conta enquanto a aba está VISÍVEL. Aba de fundo aberta a tarde inteira
 * não vira "40 minutos de leitura" — esse é o erro clássico que faz o tempo
 * médio de qualquer landing parecer ótimo.
 *
 * ── Como os dados saem daqui ──────────────────────────────────────────────
 * `navigator.sendBeacon`, que o navegador entrega mesmo com a aba fechando —
 * um `fetch` no `beforeunload` é cancelado na hora e o último trecho da
 * visita (justamente o mais informativo) se perde. Manda a cada 15 s, quando
 * a aba some e quando acontece algo que vale marcar.
 *
 * ── O que NÃO é coletado ──────────────────────────────────────────────────
 * Nada que identifique alguém: sem IP, sem e-mail, sem cookie de domínio
 * cruzado. A `sessao` é aleatória e mora no sessionStorage — fechou a aba,
 * acabou. Por isso a mesma pessoa voltando amanhã conta como visita nova, o
 * que é o certo para medir a PÁGINA em vez de perseguir a pessoa.
 */

type Estado = {
  sessao: string;
  segundos: number;
  rolagem: number;
  cliquesCta: number;
  cliquesZap: number;
  planoVisto: number | null;
  marcos: Set<string>;
};

const INTERVALO_ENVIO = 15000;

function novaSessao(): string {
  try {
    const guardada = sessionStorage.getItem("fh_prazos_sessao");
    if (guardada) return guardada;
    const nova =
      (crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2)).slice(0, 40);
    sessionStorage.setItem("fh_prazos_sessao", nova);
    return nova;
  } catch {
    // Navegação privada com storage bloqueado: a visita ainda conta, só não
    // sobrevive a um F5.
    return String(Date.now()) + Math.random().toString(36).slice(2, 8);
  }
}

export default function MedidorDaPagina({ pagina = "/prazos" }: { pagina?: string }) {
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const est: Estado = {
      sessao: novaSessao(),
      segundos: 0,
      rolagem: 0,
      cliquesCta: 0,
      cliquesZap: 0,
      planoVisto: null,
      marcos: new Set<string>(),
    };

    const enviar = () => {
      const corpo = JSON.stringify({
        sessao: est.sessao,
        pagina,
        origem: p.get("utm_source") || (document.referrer ? "referencia" : "direto"),
        campanha: p.get("utm_campaign"),
        conteudo: p.get("utm_content"),
        gatilho: p.get("g"),
        referencia: document.referrer || null,
        dispositivo: window.innerWidth <= 760 ? "celular" : "computador",
        segundos: Math.round(est.segundos),
        rolagem: est.rolagem,
        cliquesCta: est.cliquesCta,
        cliquesZap: est.cliquesZap,
        planoVisto: est.planoVisto,
        marcos: [...est.marcos],
      });
      try {
        const blob = new Blob([corpo], { type: "application/json" });
        if (!navigator.sendBeacon?.("/api/prazos/visita", blob)) {
          fetch("/api/prazos/visita", { method: "POST", body: corpo, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
        }
      } catch {
        /* medição não atrapalha a página */
      }
    };

    // ── tempo visível ──
    let ultimoTique = Date.now();
    const tique = () => {
      const agora = Date.now();
      if (document.visibilityState === "visible") est.segundos += (agora - ultimoTique) / 1000;
      ultimoTique = agora;
    };
    const relogio = setInterval(tique, 1000);

    // ── rolagem máxima, em % ──
    const aoRolar = () => {
      const alturaUtil = document.documentElement.scrollHeight - window.innerHeight;
      if (alturaUtil <= 0) return;
      const pct = Math.round(((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100);
      if (pct > est.rolagem) est.rolagem = Math.min(100, pct);
      if (est.rolagem >= 95) est.marcos.add("chegou-ao-fim");
    };
    window.addEventListener("scroll", aoRolar, { passive: true });

    // ── o que a pessoa viu de verdade ──
    // IntersectionObserver em vez de "rolou X%": a página muda de tamanho
    // conforme o que abre, e 60% de rolagem não quer dizer que o preço
    // apareceu na tela.
    const observados: [string, string][] = [
      ["#assinar", "viu-preco"],
      ["#quem-indica", "viu-quem-indica"],
      [".demo-chrome", "viu-demonstracao"],
    ];
    const observer = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          const par = observados.find(([sel]) => e.target.matches(sel));
          if (par) est.marcos.add(par[1]);
        }
      },
      { threshold: 0.35 },
    );
    for (const [sel] of observados) {
      const el = document.querySelector(sel);
      if (el) observer.observe(el);
    }

    // ── cliques ──
    const aoClicar = (ev: MouseEvent) => {
      const alvo = (ev.target as HTMLElement | null)?.closest?.("a, button, summary") as HTMLElement | null;
      if (!alvo) return;
      const href = (alvo as HTMLAnchorElement).href || "";

      if (href.startsWith("https://pay.cakto.com.br/")) {
        est.cliquesCta += 1;
        est.marcos.add("foi-ao-checkout");
        enviar(); // este é o clique que importa: sai na hora.
        return;
      }
      if (href.startsWith("https://wa.me/")) {
        est.cliquesZap += 1;
        est.marcos.add("chamou-no-zap");
        enviar();
        return;
      }
      if (href.includes("/prazos/demo")) {
        est.marcos.add("foi-ver-a-demo");
        enviar();
        return;
      }
      if (alvo.tagName === "SUMMARY") {
        const t = (alvo.textContent || "").toLowerCase();
        est.marcos.add(t.includes("perde") ? "abriu-calculadora" : "abriu-faq");
        return;
      }
      if (alvo.tagName === "BUTTON") {
        const n = Number((alvo.textContent || "").trim());
        if (Number.isFinite(n) && n >= 1 && n <= 5) {
          est.planoVisto = n;
          est.marcos.add("escolheu-plano");
        }
      }
    };
    document.addEventListener("click", aoClicar, true);

    // ── envios ──
    const aoSumir = () => {
      tique();
      if (document.visibilityState === "hidden") enviar();
    };
    document.addEventListener("visibilitychange", aoSumir);
    window.addEventListener("pagehide", enviar);
    const periodico = setInterval(() => { tique(); enviar(); }, INTERVALO_ENVIO);

    aoRolar();
    enviar();

    return () => {
      clearInterval(relogio);
      clearInterval(periodico);
      observer.disconnect();
      window.removeEventListener("scroll", aoRolar);
      document.removeEventListener("click", aoClicar, true);
      document.removeEventListener("visibilitychange", aoSumir);
      window.removeEventListener("pagehide", enviar);
      tique();
      enviar();
    };
  }, [pagina]);

  return null;
}
