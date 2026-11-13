import { responderMaterial } from "@/lib/materiais/rota-do-material";

export const dynamic = "force-dynamic";

/** O material de divulgação personalizado (ver lib/materiais/rota-do-material.ts). */
export async function GET(req: Request) {
  return responderMaterial(new URL(req.url), "folder");
}
