"use client";

import Link from "next/link";
import { Bot, Globe2, KeyRound, Mail, Palette, Users } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { AdminUpdateCard } from "@/components/admin-update-card";
import { useBranding } from "@/components/branding-provider";
import { canSeeAdminLink } from "@/components/admin-nav-utils";
import { MaterialChevronRight } from "@/components/material-icons";
import { useCurrentUser } from "@/hooks/use-current-user";

type AdminSection = {
	href: string;
	titleKey: TranslationKey;
	descriptionKey: TranslationKey;
	icon: typeof Bot;
	permission?: "primary" | "domains" | "users";
	/** Icon disc background and glyph colour. */
	tint: string;
	color: string;
};

const sections: AdminSection[] = [
	{
		href: "/agent",
		tint: "#e8f0fe",
		color: "#1a73e8",
		titleKey: "admin.nav.agent",
		descriptionKey: "admin.section.agent",
		icon: Bot,
		permission: "primary",
	},
	{
		href: "/mailboxes",
		tint: "#f3e8fd",
		color: "#9334e6",
		titleKey: "admin.nav.mailboxes",
		descriptionKey: "admin.section.mailboxes",
		icon: Mail,
	},
	{
		href: "/domains",
		tint: "#e8f0fe",
		color: "#1967d2",
		titleKey: "admin.nav.domains",
		descriptionKey: "admin.section.domains",
		icon: Globe2,
		permission: "domains",
	},
	{
		href: "/branding",
		tint: "#fce8e6",
		color: "#d93025",
		titleKey: "admin.nav.branding",
		descriptionKey: "admin.section.branding",
		icon: Palette,
		permission: "primary",
	},
	{
		href: "/accounts",
		tint: "#e6f4ea",
		color: "#188038",
		titleKey: "admin.nav.accounts",
		descriptionKey: "admin.section.accounts",
		icon: Users,
	},
	{
		href: "/api-keys",
		tint: "#fef7e0",
		color: "#e37400",
		titleKey: "admin.section.apiKeysTitle",
		descriptionKey: "admin.section.apiKeys",
		icon: KeyRound,
		permission: "primary",
	},
	// {
	// 	href: "/webhooks",
	// 	title: "Webhooks",
	// 	description: "Send mail events to external systems.",
	// 	icon: Webhook,
	// },
	// {
	// 	href: "/settings/account",
	// 	title: "Account",
	// 	description: "View personal account and platform configuration.",
	// 	icon: Settings,
	// },
];

export default function AdminSettingsPage() {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const branding = useBranding();

	return (
		<div>
			<div className="mb-8 flex items-start gap-4">
				<img src={branding.iconUrl} alt="" width={40} height={40} className="mt-1 h-10 w-10 shrink-0 object-contain max-md:hidden" />
				<div>
					<h1 className="text-[28px] leading-9 text-[#1f1f1f]">{t("admin.title")}</h1>
					<p className="mt-1 text-sm text-[#444746]">{t("admin.description")}</p>
				</div>
			</div>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{sections.filter((section) => canSeeAdminLink(section, user)).map((section) => {
					const Icon = section.icon;

					return (
						<Link
							key={section.href}
							href={section.href}
							className="group flex items-start gap-4 rounded-2xl border border-[#e3e3e3] bg-white p-5 transition-shadow hover:shadow-[0_1px_2px_rgba(60,64,67,0.3),0_2px_6px_2px_rgba(60,64,67,0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]"
						>
							<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: section.tint, color: section.color }}>
								<Icon className="h-6 w-6" strokeWidth={1.75} />
							</span>
							<span className="min-w-0 flex-1">
								<span className="flex items-center justify-between gap-2">
									<span className="text-base font-medium text-[#1f1f1f]">{t(section.titleKey)}</span>
									<MaterialChevronRight size={22} className="shrink-0 text-[#444746] transition-transform group-hover:translate-x-0.5" />
								</span>
								<span className="mt-1 block text-sm leading-5 text-[#444746]">{t(section.descriptionKey)}</span>
							</span>
						</Link>
					);
				})}
			</div>
			{user?.isPrimaryAdmin && (
				<div className="mt-6">
					<AdminUpdateCard />
				</div>
			)}
		</div>
	);
}
