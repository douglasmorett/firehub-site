import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// Fila em memória por franqueado (rápido e sem overhead)
const queueMap = new Map<string, any[]>();

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json();
    const { franchiseeId, order, storeName, paperWidth } = body;

    let targetId = franchiseeId;
    if (!targetId && session?.user?.email) {
      const u = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, ownerId: true }
      });
      targetId = u?.ownerId || u?.id;
    }

    if (!targetId) {
      return NextResponse.json({ error: "Franchisee ID obrigatorio" }, { status: 400 });
    }

    const job = {
      id: "job_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      order,
      storeName: storeName || "FIREHUB",
      paperWidth: paperWidth || "80mm",
      createdAt: new Date().toISOString(),
    };

    if (!queueMap.has(targetId)) {
      queueMap.set(targetId, []);
    }
    const q = queueMap.get(targetId)!;
    q.push(job);
    // Limita tamanho da fila a 50 jobs
    if (q.length > 50) q.shift();

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const franchiseeId = searchParams.get("franchiseeId");
    const all = searchParams.get("all") === "true";

    if (all || !franchiseeId) {
      const allJobs: any[] = [];
      for (const [_, jobs] of queueMap.entries()) {
        allJobs.push(...jobs);
      }
      queueMap.clear();
      return NextResponse.json({ jobs: allJobs });
    }

    const q = queueMap.get(franchiseeId) || [];
    queueMap.set(franchiseeId, []);
    return NextResponse.json({ jobs: q });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
