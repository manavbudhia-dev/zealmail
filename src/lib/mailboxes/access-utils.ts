import type { AppDatabase } from "@/db";

/**
 * Whether shared (team) mailboxes are visible to the members they are shared with.
 *
 * ZealMail unlocks every Team feature (see `getLicenseEntitlements` in `src/lib/licenses/service.ts`),
 * so this is always on. It used to read the stored license row, which stays "community" because no
 * key is ever activated: admins could create a shared mailbox and add members, but the members never
 * saw it, could not open its messages and got no realtime updates for it.
 */
export async function isTeamMailboxSharingEnabled(_db: AppDatabase): Promise<boolean> {
	return true;
}
