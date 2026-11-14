const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/**
 * UUIDv7: 48-bit millisecond timestamp, then random bits. Time-ordered, so ids sort roughly by
 * creation and clients can mint them offline (SPEC 4d). Not monotonic within the same millisecond.
 */
export function uuidv7(now: number = Date.now()): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  // Big-endian 48-bit timestamp; Number can't shift past 32 bits, so divide instead.
  let t = now
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256
    t = Math.floor(t / 256)
  }
  b[6] = (b[6]! & 0x0f) | 0x70 // version 7
  b[8] = (b[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const h = Array.from(b, (x) => HEX[x]!)
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}
