import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { arquivosDoTutorial, duracaoEmMinutos, grupoDoTutorial, tutorialPorId, type Tutorial } from "@/lib/tutoriais";
import { Ajuda, CartaoDoTutorial, Rodape, Topo, enviadosAgora } from "../partes";
import PlayerDoTutorial from "./PlayerDoTutorial";
import css from "../tutoriais.module.css";

// Lê o disco a cada visita: vídeo regravado troca de versão (e de endereço do arquivo), o link não.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** O vídeo, se ele já está no servidor. Link de vídeo que ainda não chegou dá 404, nunca player vazio. */
function tutorialNoAr(id: string, enviados = enviadosAgora()): Tutorial | null {
  const t = tutorialPorId(id);
  return t && (!enviados || enviados.has(t.id)) ? t : null;
}

const descricaoDe = (t: Tutorial) =>
  `Vídeo de ${duracaoEmMinutos(t.duracao)} no painel do FireHub: ${t.capitulos.map((c) => c.titulo).join(", ")}.`;

/**
 * A prévia do link no WhatsApp (título, capa e descrição): é o que o lojista vê
 * antes de tocar, quando o robô do atendimento manda o vídeo.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = tutorialNoAr(id);
  if (!t) return { title: "Tutorial — FireHub" };
  const { capa } = arquivosDoTutorial(t);
  return {
    title: `${t.titulo} — Tutorial FireHub`,
    description: descricaoDe(t),
    openGraph: {
      title: t.titulo,
      description: descricaoDe(t),
      url: `/tutoriais/${t.id}`,
      siteName: "FireHub",
      locale: "pt_BR",
      type: "video.other",
      images: [{ url: capa, alt: t.titulo }],
    },
  };
}

/**
 * UM TUTORIAL, SEM LOGIN — o endereço que o robô do atendimento manda no
 * WhatsApp (lib/atendimento/videos.ts). `?t=95` abre já no capítulo.
 *
 * O link é o id, não o arquivo: o arquivo mora numa pasta por versão
 * (tutoriais/<id>/<versao>/) e muda a cada regravação; este endereço não, e o
 * link mandado ontem continua abrindo o vídeo de hoje.
 */
export default async function PaginaDoTutorial({ params, searchParams }: Props) {
  const { id } = await params;
  const busca = await searchParams;
  const enviados = enviadosAgora();
  const tutorial = tutorialNoAr(id, enviados);
  if (!tutorial) notFound();

  const t = Array.isArray(busca.t) ? busca.t[0] : busca.t;
  const comecaEm = Math.max(0, Math.min(Math.floor(Number(t) || 0), Math.max(0, tutorial.duracao - 1)));
  const grupo = grupoDoTutorial(tutorial.id);
  const outros = (grupo?.ids || [])
    .filter((outro) => outro !== tutorial.id)
    .map((outro) => tutorialNoAr(outro, enviados))
    .filter((x): x is Tutorial => !!x);

  return (
    <div className={css.fundo}>
      <Topo />
      <main className={css.pagina}>
        <Link href="/tutoriais" className={css.voltar}>
          ← Todos os tutoriais
        </Link>
        {grupo && <p className={css.sobretitulo}>{grupo.titulo}</p>}
        <h1 className={css.titulo}>{tutorial.titulo}</h1>
        <p className={css.meta}>
          Vídeo de {duracaoEmMinutos(tutorial.duracao)} · {tutorial.capitulos.length} capítulos
        </p>

        <PlayerDoTutorial tutorial={tutorial} arquivos={arquivosDoTutorial(tutorial)} comecaEm={comecaEm} />

        <Ajuda assunto={tutorial.titulo} />

        {outros.length > 0 && (
          <section className={css.secao} aria-labelledby="outros-videos">
            <h2 id="outros-videos" className={css.secaoTitulo}>
              Outros vídeos{grupo ? ` de ${grupo.titulo}` : ""}
            </h2>
            <ul className={css.grade}>
              {outros.map((o) => (
                <li key={o.id}>
                  <CartaoDoTutorial tutorial={o} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <Rodape />
      </main>
    </div>
  );
}
