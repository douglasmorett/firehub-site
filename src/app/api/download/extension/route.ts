import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    for (let j = 0; j < 8; j++) {
      let bit = (byte ^ crc) & 1;
      crc = (crc >>> 1) ^ (bit ? 0xedb88320 : 0);
      byte >>>= 1;
    }
  }
  return (crc ^ -1) >>> 0;
}

function packZip(files: { name: string; content: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const cdRecords: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, "utf-8");
    const dataBuf = file.content;
    const crc = crc32(dataBuf);
    const size = dataBuf.length;

    // Local Header
    const localHeader = Buffer.alloc(30 + filenameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(10, 4);          // Version needed
    localHeader.writeUInt16LE(0, 6);           // General purpose bit flag
    localHeader.writeUInt16LE(0, 8);           // Compression method (0 = Stored)
    localHeader.writeUInt16LE(0, 10);          // DOS time
    localHeader.writeUInt16LE(0, 12);          // DOS date
    localHeader.writeUInt32LE(crc, 14);        // CRC-32
    localHeader.writeUInt32LE(size, 18);       // Compressed size
    localHeader.writeUInt32LE(size, 22);       // Uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26); // Filename length
    localHeader.writeUInt16LE(0, 28);          // Extra field length
    filenameBuf.copy(localHeader, 30);

    parts.push(localHeader);
    parts.push(dataBuf);

    // Central Directory Record
    const cdRecord = Buffer.alloc(46 + filenameBuf.length);
    cdRecord.writeUInt32LE(0x02014b50, 0);     // Central directory signature
    cdRecord.writeUInt16LE(20, 4);             // Version made by
    cdRecord.writeUInt16LE(10, 6);             // Version needed
    cdRecord.writeUInt16LE(0, 8);              // Flags
    cdRecord.writeUInt16LE(0, 10);             // Compression method
    cdRecord.writeUInt16LE(0, 12);             // Time
    cdRecord.writeUInt16LE(0, 14);             // Date
    cdRecord.writeUInt32LE(crc, 16);           // CRC-32
    cdRecord.writeUInt32LE(size, 20);          // Compressed size
    cdRecord.writeUInt32LE(size, 24);          // Uncompressed size
    cdRecord.writeUInt16LE(filenameBuf.length, 28); // Filename length
    cdRecord.writeUInt16LE(0, 30);             // Extra field length
    cdRecord.writeUInt16LE(0, 32);             // File comment length
    cdRecord.writeUInt16LE(0, 34);             // Disk number start
    cdRecord.writeUInt16LE(0, 36);             // Internal file attributes
    cdRecord.writeUInt32LE(0, 38);             // External file attributes
    cdRecord.writeUInt32LE(offset, 42);        // Relative offset of local header
    filenameBuf.copy(cdRecord, 46);

    cdRecords.push(cdRecord);
    offset += localHeader.length + dataBuf.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of cdRecords) {
    parts.push(cd);
    cdSize += cd.length;
  }

  // End of Central Directory Record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);           // EOCD signature
  eocd.writeUInt16LE(0, 4);                    // Disk number
  eocd.writeUInt16LE(0, 6);                    // Disk with CD
  eocd.writeUInt16LE(files.length, 8);         // CD entries on this disk
  eocd.writeUInt16LE(files.length, 10);        // Total CD entries
  eocd.writeUInt32LE(cdSize, 12);              // Size of CD
  eocd.writeUInt32LE(cdOffset, 16);            // Offset of CD
  eocd.writeUInt16LE(0, 20);                   // Comment length

  parts.push(eocd);
  return Buffer.concat(parts);
}

export async function GET(req: NextRequest) {
  try {
    const extDir = path.join(process.cwd(), "firehub-ifood-extension");

    function getFilesRecursively(dir: string, baseDir: string): { name: string; content: Buffer }[] {
      let results: { name: string; content: Buffer }[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getFilesRecursively(fullPath, baseDir));
        } else {
          const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
          results.push({
            name: relPath,
            content: fs.readFileSync(fullPath),
          });
        }
      }
      return results;
    }

    const files = getFilesRecursively(extDir, extDir);
    const zipBuffer = packZip(files);

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="firehub-ifood-extension.zip"',
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (err: any) {
    console.error("[Download Extension Zip Error]", err);
    return NextResponse.json({ error: "Erro ao gerar arquivo ZIP da extensão" }, { status: 500 });
  }
}
