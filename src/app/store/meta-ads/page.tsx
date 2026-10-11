import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import TrafegoPagoClient from "@/components/customer/TrafegoPagoClient";
import { lerCoordenadaDaLoja, raioSugerido } from "@/lib/publico-do-anuncio";

export const metadata = { title: "Tráfego Pago — FireHub" };

export default async function TrafegoPagoPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, storeName: true, slug: true, storeLatLng: true, storeAddress: true, deliveryZones: true },
  });
  if (!user) redirect("/login");

  // O mapa do "Quem vai ver" já abre na loja e no raio que ela entrega. Sem
  // ponto no mapa a tela avisa antes — o servidor recusaria do mesmo jeito.
  const localDaLoja = {
    centro: lerCoordenadaDaLoja(user.storeLatLng),
    endereco: user.storeAddress ?? "",
    raioSugerido: raioSugerido(user.deliveryZones),
  };

  return (
    <div style={{ padding: "1.5rem 1rem" }}>
      <TrafegoPagoClient
        user={{ id: user.id, storeName: user.storeName, slug: user.slug }}
        localDaLoja={localDaLoja}
      />
    </div>
  );
}
