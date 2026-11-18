import {
	Activity,
	Bot,
	DatabaseBackup,
	Globe2,
	Home,
	KeyRound,
	LockKeyhole,
	Mail,
	Palette,
	Route,
	Settings,
	ShieldCheck,
	Users,
	Webhook,
} from "@/components/icons";
import type { TranslationKey } from "@/lib/i18n/types";
import type { CurrentUser } from "@/hooks/use-current-user";

export type AdminLinkPermission = "primary" | "domains" | "users";

export type AdminNavLink = {
	href: string;
	labelKey: TranslationKey;
	icon: typeof Settings;
	permission?: AdminLinkPermission;
};

// `id` names a section for its remembered open/closed state; it is not shown.
export const adminNavSections: { id?: string; labelKey?: TranslationKey; links: AdminNavLink[] }[] = [
	{
		// label: "Overview",
		links: [{ href: "/admin", labelKey: "admin.nav.overview", icon: Home }],
	},
	{
		id: "Email",
		labelKey: "admin.nav.email",
		links: [
			{ href: "/mailboxes", labelKey: "admin.nav.mailboxes", icon: Mail },
			{ href: "/domains", labelKey: "admin.nav.domains", icon: Globe2, permission: "domains" },
			{ href: "/routing", labelKey: "admin.nav.routing", icon: Route, permission: "domains" },
			{ href: "/webhooks", labelKey: "admin.nav.webhooks", icon: Webhook, permission: "primary" },
			{ href: "/spam-filter", labelKey: "admin.nav.spamFilter", icon: ShieldCheck, permission: "primary" },
		],
	},
	{
		id: "Administration",
		labelKey: "admin.nav.administration",
		links: [
			{ href: "/api-keys", labelKey: "admin.nav.apiKeys", icon: KeyRound, permission: "primary" },
			{ href: "/general", labelKey: "admin.nav.general", icon: Settings, permission: "primary" },
			{ href: "/security", labelKey: "admin.nav.security", icon: LockKeyhole, permission: "primary" },
			{ href: "/agent", labelKey: "admin.nav.agent", icon: Bot, permission: "primary" },
			{ href: "/accounts", labelKey: "admin.nav.accounts", icon: Users },
			{ href: "/activity", labelKey: "admin.nav.activity", icon: Activity, permission: "primary" },
			{ href: "/backups", labelKey: "admin.nav.backups", icon: DatabaseBackup, permission: "primary" },
		],
	},
	{
		id: "Product",
		labelKey: "admin.nav.product",
		links: [
			{ href: "/branding", labelKey: "admin.nav.branding", icon: Palette, permission: "primary" },
		],
	},
];

/** Whether this account's admin permissions reach a link; links without a permission are open to every admin. */
export function canSeeAdminLink(link: Pick<AdminNavLink, "permission">, user: Pick<CurrentUser, "isPrimaryAdmin" | "canManageDomains" | "canManageUsers"> | null): boolean {
	if (!link.permission) return true;
	if (!user) return false;
	if (link.permission === "primary") return user.isPrimaryAdmin;
	if (link.permission === "domains") return user.isPrimaryAdmin || user.canManageDomains;
	return user.isPrimaryAdmin || user.canManageUsers;
}
