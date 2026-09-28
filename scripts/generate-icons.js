import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPNG(width, height) {
  // RGBA buffer
  const buffer = Buffer.alloc(width * height * 4);

  const cx = width / 2;
  const cy = height / 2;
  const rOuter = width * 0.42;
  const rInner = width * 0.38;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Deep dark slate background #0f172a
      let r = 15;
      let g = 23;
      let b = 42;
      let a = 255;

      // Outer ring / border
      if (dist <= rOuter && dist >= rInner) {
        // Emerald to cyan gradient
        const t = (x / width);
        r = Math.round(16 + (6 - 16) * t);
        g = Math.round(185 + (182 - 185) * t);
        b = Math.round(129 + (212 - 129) * t);
      } else if (dist < rInner) {
        // Inner circle nodes & mesh
        const isCenterNode = Math.sqrt(dx * dx + (dy + 10) * (dy + 10)) < (width * 0.09);
        const isLeftNode = Math.sqrt((dx + width * 0.2) ** 2 + (dy - 10) ** 2) < (width * 0.07);
        const isRightNode = Math.sqrt((dx - width * 0.2) ** 2 + (dy - 10) ** 2) < (width * 0.07);
        const isTopNode = Math.sqrt(dx ** 2 + (dy + width * 0.22) ** 2) < (width * 0.07);
        const isBottomNode = Math.sqrt(dx ** 2 + (dy - width * 0.22) ** 2) < (width * 0.07);

        if (isCenterNode) {
          r = 16; g = 185; b = 129; // Emerald #10b981
        } else if (isLeftNode || isRightNode || isTopNode || isBottomNode) {
          r = 6; g = 182; b = 212; // Cyan #06b6d4
        } else {
          // Dark background inside bubble
          r = 20; g = 30; b = 55;
        }
      }

      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = a;
    }
  }

  // PNG encoding
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth 8
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT (filter byte 0 per line)
  const rowSize = width * 4;
  const rawData = Buffer.alloc(height * (rowSize + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (rowSize + 1)] = 0; // Filter None
    buffer.copy(rawData, y * (rowSize + 1) + 1, y * rowSize, (y + 1) * rowSize);
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const typeAndData = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crcBuf]);
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), createPNG(192, 192));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), createPNG(512, 512));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), createPNG(512, 512));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPNG(180, 180));
console.log('Successfully generated all PWA PNG icons!');
