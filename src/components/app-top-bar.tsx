"use client";

import Link from "next/link";
import { Settings } from "@/components/icons";
import { MailboxSelector } from "@/components/mailbox-selector";
import { useShortcuts } from "@/components/shortcuts";
import { ZEALMAIL_SOURCE_URL } from "@/lib/zealmail";
import { useBranding } from "./branding-provider";
import { useLanguage } from "./language-provider";
import { MaterialHelp, MaterialMenu } from "./material-icons";
import { MobileMenuButton } from "./sidebar-aside";
import { useSidebar } from "./sidebar-state";
import { Tooltip } from "./ui/tooltip";
import type { AppTopBarProps } from "./app-top-bar-types";

const iconButton = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#444746] transition-colors hover:bg-[#e8eaed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]";

/**
 * The Workspace-style app bar shared by mail, settings, admin and Drive: menu toggle and
 * product mark over the sidebar column, the search field, then help, settings, the apps
 * grid and the account avatar. It spans the full width above the sidebar and content.
 */
export function AppTopBar({ homeHref = "/inbox", label, search, actions }: AppTopBarProps) {
	const { t } = useLanguage();
	const branding = useBranding();
	const { minimal, toggle } = useSidebar();
	const { openHelpModal, shortcutsEnabled, shortcutsPreferenceLoading } = useShortcuts();
	const helpOpensShortcuts = shortcutsEnabled && !shortcutsPreferenceLoading;

	return (
		<header className="flex h-16 w-full shrink-0 items-center gap-2 pr-2 text-sm md:pr-3">
			<MobileMenuButton className="ml-2" />
			{/* At least as wide as the sidebar column, so the search lines up with the content; never narrower than the mark. */}
			<div className="hidden shrink-0 items-center gap-1 pl-2 pr-4 transition-[min-width] md:flex" style={{ minWidth: "max(var(--sidebar-width), 238px)", transitionDuration: "var(--sidebar-transition-duration)" }}>
				<Tooltip label={minimal ? t("navigation.expandMenu") : t("navigation.collapseMenu")}>
					<button type="button" onClick={toggle} className={`${iconButton} h-12 w-12`} aria-label={minimal ? t("navigation.expandMenu") : t("navigation.collapseMenu")}>
						<MaterialMenu size={24} />
					</button>
				</Tooltip>
				<Link href={homeHref} className="flex min-w-0 items-center gap-2 rounded-lg pl-1 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]">
					<img src={branding.iconUrl} height={36} width={36} alt="" className="h-9 w-9 shrink-0 object-contain" />
					<span className="truncate text-[22px] leading-7 text-[#1f1f1f]">
						<span className="font-medium tracking-tight">{branding.appName}</span>
						{label && <span className="text-[#444746]"> {label}</span>}
					</span>
				</Link>
			</div>
			{search ?? <div className="flex-1" />}
			<div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
				{actions}
				<Tooltip label={helpOpensShortcuts ? t("navigation.shortcuts") : t("navigation.help")}>
					{helpOpensShortcuts ? (
						<button type="button" onClick={openHelpModal} className={`${iconButton} max-md:hidden`} aria-label={t("navigation.shortcuts")}>
							<MaterialHelp size={24} />
						</button>
					) : (
						<a href={ZEALMAIL_SOURCE_URL} target="_blank" rel="noreferrer" className={`${iconButton} max-md:hidden`} aria-label={t("navigation.help")}>
							<MaterialHelp size={24} />
						</a>
					)}
				</Tooltip>
				<Tooltip label={t("account.settings")}>
					<Link href="/settings" className={`${iconButton} max-md:hidden`} aria-label={t("account.settings")}>
						<Settings size={22} strokeWidth={1.8} />
					</Link>
				</Tooltip>
				<MailboxSelector />
			</div>
		</header>
	);
}
