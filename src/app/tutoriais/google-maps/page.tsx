import type { Metadata } from "next";
import Link from "next/link";
import { PASSOS_PARA_CONECTAR, TEXTO_DA_FAIXA, partesDoPasso } from "@/lib/google-maps-da-loja";
import { Ajuda, Rodape, Topo } from "../partes";
import css from "../tutoriais.module.css";

/**
 * /tutoriais/google-maps — como a loja conecta a conta do Google
 * (lib/google-maps-da-loja.ts). O link sai do botão "Ver vídeo" da faixa
 * "Problemas no mapa?" da roteirização.
 *
 * O VÍDEO AINDA NÃO FOI GRAVADO (01/11/2026): os tutoriais em vídeo saem da
 * gravação (`node tutoriais/publicar.mjs <id>`, lib/tutoriais.ts). Até lá a
 * página mostra o passo a passo escrito, o mesmo da tela. Quando o vídeo for
 * publicado com o id "google-maps", apague esta pasta: /tutoriais/[id] passa
 * a mostrar o vídeo no mesmo endereço.
 */

const TITULO = "Conectar o mapa do Google";

export const metadata: Metadata = {
  title: `${TITULO} — Tutorial FireHub`,
  description: "Passo a passo para a loja conectar a própria conta do Google e ter endereços, bairros e rotas pelo mapa do Google no FireHub.",
};

export default function TutorialDoGoogleMaps() {
  return (
    <div className={css.fundo}>
      <Topo />
      <main className={css.pagina}>
        <Link href="/tutoriais" className={css.voltar}>
          ← Todos os tutoriais
        </Link>
        <p className={css.sobretitulo}>Roteirização</p>
        <h1 className={css.titulo}>{TITULO}</h1>
        <p className={css.meta}>Passo a passo · uns 10 minutos · o vídeo está chegando</p>
        <p className={css.intro}>{TEXTO_DA_FAIXA}</p>

        <section className={css.secao} aria-labelledby="passos">
          <h2 id="passos" className={css.secaoTitulo}>
            Como conectar
          </h2>
          <ol className={css.capitulos}>
            {PASSOS_PARA_CONECTAR.map((texto, n) => (
              <li key={n} style={{ padding: "12px 16px", lineHeight: 1.5, fontSize: 15 }}>
                <b>{n + 1}.</b> {partesDoPasso(texto).map((x, k) => (x.negrito ? <b key={k}>{x.t}</b> : <span key={k}>{x.t}</span>))}
              </li>
            ))}
          </ol>
        </section>

        <section className={css.secao} aria-labelledby="duvidas">
          <h2 id="duvidas" className={css.secaoTitulo}>
            Se der erro
          </h2>
          <ol className={css.capitulos}>
            <li style={{ padding: "12px 16px", lineHeight: 1.5, fontSize: 15 }}>
              <b>&quot;A Geocoding API não está ativada&quot;</b>: volte no passo 3 e ative a Geocoding API no mesmo projeto da chave.
            </li>
            <li style={{ padding: "12px 16px", lineHeight: 1.5, fontSize: 15 }}>
              <b>&quot;O faturamento não está ativado&quot;</b>: volte no passo 2. Sem o cartão cadastrado o Google não libera a chave.
            </li>
            <li style={{ padding: "12px 16px", lineHeight: 1.5, fontSize: 15 }}>
              <b>&quot;A chave está restrita por site&quot;</b>: na chave, deixe &quot;Restrições do aplicativo&quot; em Nenhum e use só as Restrições de API
              (Geocoding API e Maps JavaScript API).
            </li>
            <li style={{ padding: "12px 16px", lineHeight: 1.5, fontSize: 15 }}>
              <b>&quot;O mapa do Google não abriu&quot;</b>: a busca funciona, mas o mapa não — ative a Maps JavaScript API (passo 3) e confira que ela
              está marcada nas Restrições de API da chave (passo 4).
            </li>
          </ol>
        </section>

        <Ajuda assunto={TITULO} />
        <Rodape />
      </main>
    </div>
  );
}
