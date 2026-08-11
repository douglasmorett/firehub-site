import TotemApp from "./TotemApp";

export default async function TotemPage({ params, searchParams }: { 
  params: Promise<{ slug: string }>,
  searchParams: Promise<{ token?: string }>
}) {
  const { slug } = await params;
  const { token } = await searchParams;
  return <TotemApp slug={slug} token={token || ""} />;
}
