// Draws the Errand app icon (ink square, cream "E") as PNGs without any image tools.
import { deflateSync } from "node:zlib";

const INK = [0x1b, 0x1b, 0x18], CREAM = [0xf5, 0xf3, 0xee];

function crc32(buf: Uint8Array): number {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function icon(size: number): Uint8Array {
  // The "E": a stem and three bars, proportioned on a 24-unit grid.
  const u = size / 24;
  const inE = (x: number, y: number) => {
    const gx = x / u, gy = y / u;
    if (gx < 7.5 || gx > 16.5 || gy < 5.5 || gy > 18.5) return false;
    if (gx < 10) return true; // stem
    if (gy < 8) return true; // top bar
    if (gy > 10.75 && gy < 13.25 && gx < 15.5) return true; // middle bar
    if (gy > 16) return true; // bottom bar
    return false;
  };
  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = inE(x + 0.5, y + 0.5) ? CREAM : INK;
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = r!; raw[i + 1] = g!; raw[i + 2] = b!;
    }
  }
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, size); hv.setUint32(4, size);
  header[8] = 8; header[9] = 2; // 8-bit RGB
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { png.set(p, offset); offset += p.length; }
  return png;
}

for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]] as const) {
  await Bun.write(`public-static/${name}`, icon(size));
}
// The native iPhone app's icon (one 1024px image; iOS scales it).
await Bun.write("../ios/Errand/Assets.xcassets/AppIcon.appiconset/icon-1024.png", icon(1024));
console.log("Icons written to web/public-static/ and ios/Errand/Assets.xcassets/");
