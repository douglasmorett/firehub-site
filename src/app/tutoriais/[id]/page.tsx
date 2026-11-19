import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getImageProps } from "next/image";
import { arquivosDoTutorial, duracaoEmMinutos, grupoDoTutorial, tutorialPorId, type Tutorial } from "@/lib/tutoriais";
import { enviadoEm } from "@/lib/tutoriais-no-servidor";
import { SITE, cortar, jsonLd, metadataDaPagina, trilha } from "@/lib/seo";
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
  cortar(`Tutorial em vídeo de ${duracaoEmMinutos(t.duracao)} no painel do FireHub: ${t.capitulos.map((c) => c.titulo.toLowerCase()).join(", ")}.`, 158);

/** Título da aba e do Google: até 60 letras, com a marca quando cabe. */
const tituloDe = (t: Tutorial) =>
  `${t.titulo} — Tutorial FireHub`.length <= 60 ? `${t.titulo} — Tutorial FireHub` : cortar(`${t.titulo} | FireHub`, 60);

const absoluto = (url: string) => new URL(url, SITE).toString();

/** ISO 8601 (PT3M14S), o formato do `duration` do schema.org. */
const duracaoIso = (s: number) => {
  const total = Math.round(s);
  return `PT${Math.floor(total / 60)}M${total % 60}S`;
};

/**
 * O VideoObject do Google (vídeo na busca, com os capítulos como "momentos
 * importantes"). Sem a data do envio não sai: o Google recusa VideoObject sem
 * `uploadDate`.
 */
function videoDoTutorial(t: Tutorial) {
  const quando = enviadoEm(t);
  if (!quando) return null;
  const { video, capa } = arquivosDoTutorial(t);
  const url = `${SITE}/tutoriais/${t.id}`;
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: t.titulo,
    description: descricaoDe(t),
    thumbnailUrl: [absoluto(capa)],
    uploadDate: quando.toISOString(),
    duration: duracaoIso(t.duracao),
    contentUrl: absoluto(video),
    inLanguage: "pt-BR",
    publisher: { "@type": "Organization", name: "FireHub", url: SITE, logo: { "@type": "ImageObject", url: `${SITE}/icon.png` } },
    hasPart: t.capitulos.map((c, i) => ({
      "@type": "Clip",
      name: c.titulo,
      startOffset: Math.floor(c.em),
      endOffset: Math.floor(t.capitulos[i + 1]?.em ?? t.duracao),
      url: `${url}?t=${Math.floor(c.em)}`,
    })),
  };
}

/**
 * A prévia do link no WhatsApp (título, capa e descrição): é o que o lojista vê
 * antes de tocar, quando o robô do atendimento manda o vídeo.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = tutorialNoAr(id);
  if (!t) return { title: "Tutorial — FireHub" };
  const { capa } = arquivosDoTutorial(t);
  const meta = metadataDaPagina({
    titulo: tituloDe(t),
    descricao: descricaoDe(t),
    caminho: `/tutoriais/${t.id}`,
    tipo: "video.other",
    imagem: { url: capa, alt: t.titulo },
  });
  // Na prévia do WhatsApp o título fica só o do vídeo, como sempre foi.
  return { ...meta, openGraph: { ...meta.openGraph, title: t.titulo } };
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

  const video = videoDoTutorial(tutorial);
  const arquivos = arquivosDoTutorial(tutorial);
  // O pôster é a imagem maior da página (LCP): sai pelo otimizador do Next
  // (WebP no tamanho da tela, ~25 KB em vez dos ~170 KB do capa.jpg). Capa em
  // endereço externo continua como está.
  const poster = arquivos.capa.startsWith("/")
    ? getImageProps({ src: arquivos.capa, alt: "", width: 540, height: 304 }).props.src
    : arquivos.capa;

  return (
    <div className={css.fundo}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(trilha([["Início", "/"], ["Tutoriais", "/tutoriais"], [tutorial.titulo, `/tutoriais/${tutorial.id}`]])) }}
      />
      {video && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(video) }} />}
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

        <PlayerDoTutorial tutorial={tutorial} arquivos={{ ...arquivos, capa: poster }} comecaEm={comecaEm} />

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
