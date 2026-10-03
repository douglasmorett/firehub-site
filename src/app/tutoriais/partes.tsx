import Link from "next/link";
import { arquivosDoTutorial, duracaoEmMinutos, type Tutorial } from "@/lib/tutoriais";
import { tutoriaisEnviados } from "@/lib/tutoriais-no-servidor";
import css from "./tutoriais.module.css";

/** O número do atendimento do FireHub — o mesmo das tarjas do painel (CopiamosSeuCardapio, MandeSeusBairros). */
const WHATSAPP_DO_FIREHUB = "5522981118514";

/** Ids com o vídeo no servidor; null = não dá para saber (endereço externo), todos valem. */
export function enviadosAgora(): ReadonlySet<string> | null {
  const ids = tutoriaisEnviados();
  return ids ? new Set(ids) : null;
}

export function Topo() {
  return (
    <header className={css.topo}>
      <div className={css.topoMiolo}>
        <Link href="/" className={css.marca}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/firehub-flame.png" alt="" width={26} height={26} />
          FireHub
        </Link>
        <Link href="/tutoriais" className={css.topoLink}>
          Tutoriais
        </Link>
      </div>
    </header>
  );
}

export function CartaoDoTutorial({ tutorial }: { tutorial: Tutorial }) {
  return (
    <Link href={`/tutoriais/${tutorial.id}`} className={css.cartao}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={css.capa} src={arquivosDoTutorial(tutorial).capa} alt="" loading="lazy" />
      <span className={css.cartaoTexto}>
        <span className={css.cartaoTitulo}>{tutorial.titulo}</span>
        <span className={css.cartaoMeta}>{duracaoEmMinutos(tutorial.duracao)}</span>
      </span>
    </Link>
  );
}

/** "Ficou com dúvida?" — abre o WhatsApp do FireHub com a mensagem pronta; quem manda é a pessoa. */
export function Ajuda({ assunto }: { assunto?: string }) {
  const texto = assunto
    ? `Oi! Vi o tutorial "${assunto}" e fiquei com uma dúvida:`
    : "Oi! Estava vendo os tutoriais do FireHub e fiquei com uma dúvida:";
  return (
    <section className={css.ajuda}>
      <div className={css.ajudaTexto}>
        <h2>Ficou alguma dúvida?</h2>
        <p>Chame o suporte do FireHub no WhatsApp e conte o que você quer fazer.</p>
      </div>
      <a className={css.botao} href={`https://wa.me/${WHATSAPP_DO_FIREHUB}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer">
        Chamar no WhatsApp
      </a>
    </section>
  );
}

export function Rodape() {
  return (
    <p className={css.rodape}>
      Ainda não usa o FireHub? <Link href="/cadastro">Teste grátis por 15 dias</Link>
    </p>
  );
}
