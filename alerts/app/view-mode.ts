// Numbers or Graphs: how this browser wants the platform's numbers shown. Read on the server, so the first paint is
// already in the right view. A display preference only: it never changes what data a person can see.
import { cookies } from 'next/headers';

export type View = 'numbers' | 'graphs';
export const VIEW_COOKIE = 'alto_view';
/** Numbers keeps today's screens exactly; change this to 'graphs' to open in Graphs. */
export const DEFAULT_VIEW: View = 'numbers';

export const isView = (v: unknown): v is View => v === 'numbers' || v === 'graphs';

export async function readView(): Promise<View> {
  const v = (await cookies()).get(VIEW_COOKIE)?.value;
  return isView(v) ? v : DEFAULT_VIEW;
}
