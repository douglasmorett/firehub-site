import type { Metadata } from "next";
import { todosOsTutoriais } from "@/lib/tutoriais";
import { SITE, jsonLd, metadataDaPagina, trilha } from "@/lib/seo";
import { Ajuda, CartaoDoTutorial, Rodape, Topo, enviadosAgora } from "./partes";
import css from "./tutoriais.module.css";

// Lê o disco a cada visita: o vídeo aparece aqui assim que é enviado ao servidor.
export const dynamic = "force-dynamic";

export const metadata: Metadata = metadataDaPagina({
  titulo: "Tutoriais em vídeo do sistema FireHub",
  descricao: "Vídeos curtos, gravados no painel do FireHub, mostrando como usar cada tela: pedidos, cozinha, mesas, balcão, cardápio, entrega, impressoras e mais.",
  caminho: "/tutoriais",
});

/**
 * TODOS OS TUTORIAIS, SEM LOGIN — a lista que o robô do atendimento manda
 * quando a dúvida não é de uma tela só. Os mesmos vídeos da central do painel
 * (components/CentralDeTutoriais), nos mesmos grupos (lib/tutoriais.ts).
 */
export default function TutoriaisEmVideo() {
  const grupos = todosOsTutoriais(enviadosAgora());
  const ids = [...new Set(grupos.flatMap((g) => g.tutoriais.map((t) => t.id)))];
  const lista = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Tutoriais em vídeo do FireHub",
    itemListElement: ids.map((id, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/tutoriais/${id}` })),
  };
  return (
    <div className={css.fundo}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(trilha([["Início", "/"], ["Tutoriais", "/tutoriais"]])) }} />
      {ids.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(lista) }} />}
      <Topo />
      <main className={css.pagina}>
        <h1 className={css.titulo}>Tutoriais em vídeo</h1>
        <p className={css.intro}>
          Vídeos curtos, gravados no painel do FireHub, mostrando como usar cada tela. Escolha o assunto: cada vídeo tem capítulos para você pular direto ao ponto.
        </p>
        {grupos.length === 0 ? (
          <p className={css.vazio}>Os vídeos estão sendo atualizados. Volte daqui a pouco.</p>
        ) : (
          grupos.map((g) => (
            <section key={g.titulo} aria-labelledby={`grupo-${g.titulo}`}>
              <h2 id={`grupo-${g.titulo}`} className={css.grupoTitulo}>
                {g.titulo}
              </h2>
              <ul className={css.grade}>
                {g.tutoriais.map((t) => (
                  <li key={t.id}>
                    <CartaoDoTutorial tutorial={t} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <Ajuda />
        <Rodape />
      </main>
    </div>
  );
}
