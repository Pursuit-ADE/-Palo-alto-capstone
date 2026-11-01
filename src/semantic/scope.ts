// Role-based scope, resolved from the database, never from anything the user types.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { appUsers } from '../db/schema';

export interface Principal {
  userId: string;
  displayName: string;
  role: string;
  regions: string[];
  /** Sales reps whose deals and quotas this person may see; null = everyone in the allowed regions */
  ownerIds: string[] | null;
  /** Plain-language description of the slice, used in the scope statement */
  slice: string;
}

export class ScopeViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeViolation';
  }
}

export const ALL_REGIONS = ['central', 'east', 'west'];

export async function resolvePrincipal(db: Db, userId: string): Promise<Principal> {
  const [user] = await db.select().from(appUsers).where(eq(appUsers.id, userId));
  if (!user) throw new ScopeViolation('Unknown user');
  const base = { userId, displayName: user.displayName, role: user.role };
  if (user.role === 'analyst') return { ...base, regions: ALL_REGIONS, ownerIds: null, slice: 'all teams' };
  if (!user.regionId) throw new ScopeViolation('User has no region assignment');
  const regions = [user.regionId];

  if (user.role === 'sales_rep') return { ...base, regions, ownerIds: [userId], slice: 'your own deals' };

  // A manager sees their own team; a technical seller sees the team they support.
  const managerId = user.role === 'sales_manager' ? userId : user.role === 'technical_seller' ? user.managerId : null;
  if (!managerId) throw new ScopeViolation('User has no team assignment');
  const reps = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.managerId, managerId), eq(appUsers.role, 'sales_rep')));
  const [manager] = await db.select().from(appUsers).where(eq(appUsers.id, managerId));
  const managerName = manager?.displayName.split(' (')[0] ?? 'your manager';
  return { ...base, regions, ownerIds: reps.map((r) => r.id).sort(), slice: `${managerName}'s team (${reps.length} reps)` };
}

/** Regions the query will use. Asking for a region outside your scope is refused, not silently widened. */
export function effectiveRegions(principal: Principal, requested?: string[]): string[] {
  if (!requested) return principal.regions;
  const outside = requested.filter((r) => !principal.regions.includes(r));
  // A model may propose the same region twice; name it once (review, Oct 31).
  if (outside.length) throw new ScopeViolation(outsideRegions([...new Set(outside)]));
  return requested;
}

/** The refusal shown as "Not answered", in words rather than "region: west" (bug hunt, Oct 31). Names come from the fixed region list. */
function outsideRegions(regions: string[]): string {
  const names = regions.map((r) => r[0]!.toUpperCase() + r.slice(1)).join(', ').replace(/, ([^,]*)$/, ' and $1');
  return regions.length > 1
    ? `You don't have access to the ${names} regions, so I can't answer for them.`
    : `You don't have access to the ${names} region, so I can't answer for it.`;
}

export function scopeStatement(principal: Principal, regions: string[]): string {
  const regionText = regions.map((r) => r[0]!.toUpperCase() + r.slice(1)).join(', ').replace(/, ([^,]*)$/, ' and $1');
  return `Scope: ${regionText} region${regions.length > 1 ? 's' : ''}, ${principal.slice}.`;
}
