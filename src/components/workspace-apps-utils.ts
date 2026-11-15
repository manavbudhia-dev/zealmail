import { CalendarDays, HardDrive, Inbox, ShieldCheck, UsersRound } from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import type { TranslationKey } from "@/lib/i18n/types";
import type { MailboxSelectorUser } from "./mailbox-selector-types";

export type WorkspaceApp = {
	id: "mail" | "calendar" | "drive" | "contacts" | "admin";
	href: string;
	labelKey: TranslationKey;
	icon: LucideIcon;
	/** Tile background and glyph colour, in the Workspace palette. */
	tint: string;
	color: string;
};

const apps: WorkspaceApp[] = [
	{ id: "mail", href: "/inbox", labelKey: "navigation.inbox", icon: Inbox, tint: "#fce8e6", color: "#d93025" },
	{ id: "calendar", href: "/calendar", labelKey: "account.calendar", icon: CalendarDays, tint: "#e8f0fe", color: "#1a73e8" },
	{ id: "drive", href: "/drive", labelKey: "account.drive", icon: HardDrive, tint: "#fef7e0", color: "#e37400" },
	{ id: "contacts", href: "/contacts", labelKey: "navigation.contacts", icon: UsersRound, tint: "#e6f4ea", color: "#188038" },
	{ id: "admin", href: "/admin", labelKey: "account.admin", icon: ShieldCheck, tint: "#f3e8fd", color: "#9334e6" },
];

/** The apps this account can open, in launcher order. Admin only appears for admins. */
export function getWorkspaceApps(user: Pick<MailboxSelectorUser, "role" | "calendarEnabled" | "driveEnabled"> | null): WorkspaceApp[] {
	return apps.filter((app) => {
		if (app.id === "calendar") return user?.calendarEnabled !== false;
		if (app.id === "drive") return user?.driveEnabled !== false;
		if (app.id === "admin") return user?.role === "admin";
		return true;
	});
}
