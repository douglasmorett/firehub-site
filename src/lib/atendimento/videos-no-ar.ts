import { todosOsTutoriais, type Tutorial } from "@/lib/tutoriais";
import { tutoriaisEnviados } from "@/lib/tutoriais-no-servidor";

/**
 * Os vídeos que o robô pode mandar: só os que já estão no servidor, na ordem
 * da central de tutoriais. Separado de videos.ts porque olha o disco
 * (tutoriais-no-servidor.ts, com 30 s de memória) — o resto é conta pura.
 */
export function videosNoAr(): Tutorial[] {
  const enviados = tutoriaisEnviados();
  return todosOsTutoriais(enviados ? new Set(enviados) : null).flatMap((g) => g.tutoriais);
}
