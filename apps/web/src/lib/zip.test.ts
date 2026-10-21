import { describe, expect, it } from 'vitest';
import { crc32, createZip } from './zip';

describe('zip writer', () => {
  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a readable archive structure', async () => {
    const data = new TextEncoder().encode('hello');
    const blob = createZip([
      { name: 'a.txt', data, date: new Date(2026, 9, 20, 12, 0, 0) },
      { name: 'b.txt', data, date: new Date(2026, 9, 20, 12, 0, 0) },
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const eocd = bytes.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    const centralOffset = view.getUint32(eocd + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    // Second local header follows the first entry's data.
    expect(view.getUint32(30 + 5 + 5, true)).toBe(0x04034b50);
  });
});
