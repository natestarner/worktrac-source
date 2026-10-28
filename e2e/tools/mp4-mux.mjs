/* A minimal MP4 writer for one H.264 video track: what tools/marketing-demo-clip.mjs needs to turn
 * WebCodecs' encoded frames into a file Safari and every iPhone play. Edge's MediaRecorder writes
 * H.264 MP4 too, but its output froze in playback between keyframes (its inter frames referenced
 * data it never wrote), so the encoding is driven directly and only the container is built here.
 *
 *   muxMp4({ width, height, fps, avcC, samples: [{ data: Buffer, key: boolean }] }) -> Buffer
 *
 * Layout: ftyp, moov, mdat -- moov first ("faststart"), so a browser can start playing before the
 * whole file arrives. One chunk holding every sample; every sample lasts one frame (1/fps s).
 * avcC is the encoder's decoderConfig.description (WebCodecs, avc format: length-prefixed NALUs).
 */
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
};
const full = (type, version, flags, ...parts) => box(type, Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
const zeros = (n) => Buffer.alloc(n);
const MATRIX = Buffer.concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32));

export function muxMp4({ width, height, fps, avcC, samples }) {
  const n = samples.length;
  const movieTimescale = 1000;
  const durationMs = Math.round((n * 1000) / fps);

  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(0x200), Buffer.from('isomiso2avc1mp41', 'latin1'));

  const build = (mdatOffset) => {
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(movieTimescale), u32(durationMs), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2));
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durationMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16));
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(fps), u32(n), u16(0x55c4), u16(0)); // timescale = fps: one tick per frame
    const hdlr = full('hdlr', 0, 0, u32(0), Buffer.from('vide', 'latin1'), zeros(12), Buffer.from('VideoHandler\0', 'latin1'));
    const avc1 = box('avc1',
      zeros(6), u16(1),                      // reserved, data_reference_index
      zeros(16), u16(width), u16(height),    // pre_defined/reserved, size
      u32(0x00480000), u32(0x00480000),      // 72 dpi
      u32(0), u16(1), zeros(32),             // reserved, frame_count, compressorname
      u16(0x0018), u16(0xffff),              // depth, pre_defined -1
      box('avcC', Buffer.from(avcC)));
    const stsd = full('stsd', 0, 0, u32(1), avc1);
    const stts = full('stts', 0, 0, u32(1), u32(n), u32(1));
    const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
    const stss = full('stss', 0, 0, u32(keys.length), ...keys.map(u32));
    const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1));
    const stsz = full('stsz', 0, 0, u32(0), u32(n), ...samples.map((s) => u32(s.data.length)));
    const stco = full('stco', 0, 0, u32(1), u32(mdatOffset));
    const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    const minf = box('minf', full('vmhd', 0, 1, zeros(8)), dinf, stbl);
    const trak = box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
    return box('moov', mvhd, trak);
  };
  // stco holds mdat's data offset, which depends on moov's size; moov's size doesn't depend on the
  // offset's value, so build once to measure and once for real.
  const moovSize = build(0).length;
  const moov = build(ftyp.length + moovSize + 8);
  const mdat = box('mdat', ...samples.map((s) => s.data));
  return Buffer.concat([ftyp, moov, mdat]);
}
