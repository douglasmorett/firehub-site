import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await prisma.user.findFirst({
      where: { email: { contains: "contatohakim" } },
      select: { id: true, ownerId: true }
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário Hakim não encontrado" }, { status: 404 });
    }

    const franchiseeId = user.ownerId || user.id;
    const batataImgUrl = "/uploads/batata_frita.png";
    const nuggetImgUrl = "/uploads/nuggets_hk.jpg";

    // Upsert Batata Frita
    const existingBatata = await prisma.menuProduct.findFirst({
      where: { franchiseeId, name: { equals: "Batata Frita", mode: "insensitive" } }
    });

    let batataProduct;
    if (existingBatata) {
      batataProduct = await prisma.menuProduct.update({
        where: { id: existingBatata.id },
        data: {
          name: "Batata Frita",
          category: "Acompanhamentos",
          description: "Huum.. Uma batatinha.. Deu água na boca só de pensar",
          price: 9.90,
          imageUrl: batataImgUrl,
          active: true,
          activePDV: true,
          activeDelivery: true,
          isCombo: false,
          isBeverage: false
        }
      });
    } else {
      batataProduct = await prisma.menuProduct.create({
        data: {
          franchiseeId,
          name: "Batata Frita",
          category: "Acompanhamentos",
          description: "Huum.. Uma batatinha.. Deu água na boca só de pensar",
          price: 9.90,
          imageUrl: batataImgUrl,
          active: true,
          activePDV: true,
          activeDelivery: true,
          isCombo: false,
          isBeverage: false
        }
      });
    }

    // Upsert Option items for Nuggets: 6 Nuggets, 15 Nuggets, 40 Nuggets
    const opt6 = await prisma.menuProduct.upsert({
      where: {
        id: (await prisma.menuProduct.findFirst({ where: { franchiseeId, name: "6 Nuggets" } }))?.id || "opt_6_nuggets"
      },
      update: { name: "6 Nuggets", price: 9.90, category: "Acompanhamentos", description: "6 unidades de nuggets suculentos", imageUrl: nuggetImgUrl, active: true, activePDV: false, activeDelivery: false },
      create: { franchiseeId, name: "6 Nuggets", price: 9.90, category: "Acompanhamentos", description: "6 unidades de nuggets suculentos", imageUrl: nuggetImgUrl, active: true, activePDV: false, activeDelivery: false }
    });

    const opt15 = await prisma.menuProduct.upsert({
      where: {
        id: (await prisma.menuProduct.findFirst({ where: { franchiseeId, name: "15 Nuggets" } }))?.id || "opt_15_nuggets"
      },
      update: { name: "15 Nuggets", price: 19.90, category: "Acompanhamentos", description: "15 unidades de nuggets suculentos", imageUrl: nuggetImgUrl, active: true, activePDV: false, activeDelivery: false },
      create: { franchiseeId, name: "15 Nuggets", price: 19.90, category: "Acompanhamentos", description: "15 unidades de nuggets suculentos", imageUrl: nuggetImgUrl, active: true, activePDV: false, activeDelivery: false }
    });

    const opt40 = await prisma.menuProduct.upsert({
      where: {
        id: (await prisma.menuProduct.findFirst({ where: { franchiseeId, name: "40 Nuggets" } }))?.id || "opt_40_nuggets"
      },
      update: { name: "40 Nuggets", price: 39.80, category: "Acompanhamentos", description: "40 unidades de nuggets suculentos", imageUrl: nuggetImgUrl, active: true, activePDV: false, activeDelivery: false },
      create: { franchiseeId, name: "40 Nuggets", price: 39.80, category: "Acompanhamentos", description: "40 unidades de nuggets suculentos", imageUrl: nuggetImgUrl, active: true, activePDV: false, activeDelivery: false }
    });

    // Upsert Nugget main product with ComboGroup question: "Escolha sua quantidade de Nugget"
    const existingNugget = await prisma.menuProduct.findFirst({
      where: { franchiseeId, name: { equals: "Nugget", mode: "insensitive" } }
    });

    let nuggetProduct;
    if (existingNugget) {
      await prisma.comboGroup.deleteMany({ where: { menuProductId: existingNugget.id } });
      nuggetProduct = await prisma.menuProduct.update({
        where: { id: existingNugget.id },
        data: {
          name: "Nugget",
          category: "Acompanhamentos",
          description: "Delicioso e suculento nuggets",
          price: 0.00,
          imageUrl: nuggetImgUrl,
          active: true,
          activePDV: true,
          activeDelivery: true,
          isCombo: true,
          isBeverage: false,
          comboGroups: {
            create: [
              {
                title: "Escolha sua quantidade de Nugget",
                maxQty: 1,
                sortOrder: 0,
                items: {
                  create: [
                    { menuProductId: opt6.id, additionalPrice: 9.90 },
                    { menuProductId: opt15.id, additionalPrice: 19.90 },
                    { menuProductId: opt40.id, additionalPrice: 39.80 },
                  ]
                }
              }
            ]
          }
        }
      });
    } else {
      nuggetProduct = await prisma.menuProduct.create({
        data: {
          franchiseeId,
          name: "Nugget",
          category: "Acompanhamentos",
          description: "Delicioso e suculento nuggets",
          price: 0.00,
          imageUrl: nuggetImgUrl,
          active: true,
          activePDV: true,
          activeDelivery: true,
          isCombo: true,
          isBeverage: false,
          comboGroups: {
            create: [
              {
                title: "Escolha sua quantidade de Nugget",
                maxQty: 1,
                sortOrder: 0,
                items: {
                  create: [
                    { menuProductId: opt6.id, additionalPrice: 9.90 },
                    { menuProductId: opt15.id, additionalPrice: 19.90 },
                    { menuProductId: opt40.id, additionalPrice: 39.80 },
                  ]
                }
              }
            ]
          }
        }
      });
    }

    return NextResponse.json({
      ok: true,
      message: "Batata Frita e Nuggets cadastrados com sucesso!",
      batataProduct,
      nuggetProduct
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
