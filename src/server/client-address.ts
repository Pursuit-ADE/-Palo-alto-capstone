// The address the per-address sign-in limit counts against. X-Forwarded-For is trusted only for the number of
// proxies a deployment says sit in front of the app (TRUSTED_PROXY_HOPS). Each proxy appends the address it saw,
// so the caller's real address is that many entries from the right; anything further left was written by the
// caller and could be anything. With no trusted proxy (the default, e.g. `npm start` on a laptop) the headers are
// ignored and every caller shares one bucket, so a made-up header never earns extra attempts.
export const SHARED_ADDRESS = 'shared';

/** Attempts a minute per address, and for the shared bucket used when no trustworthy address is known. */
export const ATTEMPTS_PER_ADDRESS = 30;
export const ATTEMPTS_SHARED = 100;

export function clientAddress(h: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env): string {
  const hops = Number(env.TRUSTED_PROXY_HOPS || 0);
  if (!Number.isInteger(hops) || hops < 1) return SHARED_ADDRESS;
  const chain = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - hops] || SHARED_ADDRESS;
}

export function addressLimit(address: string): number {
  return address === SHARED_ADDRESS ? ATTEMPTS_SHARED : ATTEMPTS_PER_ADDRESS;
}
