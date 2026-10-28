import dotenv from "dotenv";
dotenv.config({ path: "C:/Users/Micro/Documents/firehub-site/.env.local", quiet: true });
dotenv.config({ path: "C:/Users/Micro/Documents/firehub-site/.env", quiet: true });
async function main() { const { prisma } = await import("../src/lib/prisma"); const t = Date.now(); await prisma.user.count(); console.log("banco ok", Date.now() - t, "ms"); process.exit(0); }
main().catch((e) => { console.error(String(e?.message || e).slice(0, 300)); process.exit(1); });
