// Role-based scope, resolved from the database, never from anything the user types.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { appUsers, accountTeam } from '../db/schema';

export interface Principal {
  userId: string;
  displayName: string;
  role: string;
  regions: string[];
  /** null = all accounts in the allowed regions */
  accountIds: string[] | null;
}

export class ScopeViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeViolation';
  }
}

const ALL_REGIONS = ['east', 'west'];

export async function resolvePrincipal(db: Db, userId: string): Promise<Principal> {
  const [user] = await db.select().from(appUsers).where(eq(appUsers.id, userId));
  if (!user) throw new ScopeViolation('Unknown user');
  if (user.role === 'analyst') {
    return { userId, displayName: user.displayName, role: user.role, regions: ALL_REGIONS, accountIds: null };
  }
  if (!user.regionId) throw new ScopeViolation('User has no region assignment');
  if (user.role === 'regional_manager') {
    return { userId, displayName: user.displayName, role: user.role, regions: [user.regionId], accountIds: null };
  }
  const team = await db.select({ accountId: accountTeam.accountId }).from(accountTeam).where(eq(accountTeam.userId, userId));
  return {
    userId,
    displayName: user.displayName,
    role: user.role,
    regions: [user.regionId],
    accountIds: team.map((t) => t.accountId).sort(),
  };
}

/** Regions the query will use. Asking for a region outside your scope is refused, not silently widened. */
export function effectiveRegions(principal: Principal, requested?: string[]): string[] {
  if (!requested) return principal.regions;
  const outside = requested.filter((r) => !principal.regions.includes(r));
  if (outside.length) throw new ScopeViolation(`You do not have access to region: ${outside.join(', ')}`);
  return requested;
}

export function scopeStatement(principal: Principal, regions: string[]): string {
  const regionText = regions.map((r) => r[0]!.toUpperCase() + r.slice(1)).join(' and ');
  const accounts = principal.accountIds ? `, limited to the ${principal.accountIds.length} accounts on your account team` : '';
  return `Scope: ${regionText} region${regions.length > 1 ? 's' : ''}${accounts}.`;
}
