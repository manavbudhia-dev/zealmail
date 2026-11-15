"use client";

import { SkipToContent } from "@/components/skip-to-content";
import { Suspense } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { LicenseIndicator } from "@/components/license-indicator";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { SidebarAside } from "@/components/sidebar-aside";
import { AppTopBar } from "@/components/app-top-bar";
import { useLanguage } from "@/components/language-provider";
import { SidebarHeader } from "@/components/sidebar-header";
import { SidebarResizeBoundary } from "@/components/sidebar-resize-boundary";
import { SidebarProvider, useSidebar } from "@/components/sidebar-state";
import { ShortcutsProvider } from "@/components/shortcuts";
import { DriveNav } from "./drive-nav";
import { RouteTitle } from "@/components/route-title";

function DriveFrame({ children }: { children: React.ReactNode }) {
	const { t } = useLanguage();
	const { mobile, toggle } = useSidebar();
	// Same grid and sidebar width as the dashboard, so the menu and the search line up and resizing carries over.
	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-[#f6f8fc]">
			<SkipToContent />
			<AppTopBar homeHref="/drive" label={t("account.drive")} search={<div id="drive-header-slot" className="flex min-w-0 flex-1 items-center" />} actions={<LicenseIndicator />} />
			<div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] transition-[grid-template-columns] md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]" style={{ transitionDuration: "var(--sidebar-transition-duration)" }}>
				<SidebarAside>
					<div className="flex h-full min-h-0 flex-col">
						{mobile && <div className="shrink-0 px-3 pt-4"><SidebarHeader href="/inbox" /></div>}
						<Suspense fallback={null}><DriveNav onNavigate={mobile ? toggle : undefined} /></Suspense>
					</div>
					<SidebarResizeBoundary />
				</SidebarAside>
				<main id="main-content" tabIndex={-1} className="focus:outline-none min-h-0 min-w-0 overflow-hidden md:pb-4 md:pr-4">{children}</main>
			</div>
		</div>
	);
}

export default function DriveLayout({ children }: { children: React.ReactNode }) {
	return (
		<AuthGuard requireFeature="drive">
			<SidebarProvider mobileOverlay>
				<MailboxProvider>
					<ComposeProvider>
						<MailSearchProvider>
							<ShortcutsProvider>
							  <RouteTitle />
								<DriveFrame>{children}</DriveFrame>
							</ShortcutsProvider>
						</MailSearchProvider>
					</ComposeProvider>
				</MailboxProvider>
			</SidebarProvider>
		</AuthGuard>
	);
}
