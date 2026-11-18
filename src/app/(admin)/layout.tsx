"use client";

import { SkipToContent } from "@/components/skip-to-content";
import { useLanguage } from "@/components/language-provider";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { LicenseIndicator } from "@/components/license-indicator";
import { AdminNav } from "@/components/admin-nav";
import { SidebarProvider } from "@/components/sidebar-state";
import clsx from "clsx";
import { usePathname } from "next/navigation";
import { adminPageTitles } from "@/components/admin-page-titles";
import { SidebarAside } from "@/components/sidebar-aside";
import { SidebarResizeBoundary } from "@/components/sidebar-resize-boundary";
import { ShortcutsProvider } from "@/components/shortcuts";
import { RouteTitle } from "@/components/route-title";
import { AppTopBar } from "@/components/app-top-bar";
import { AdminSearch } from "@/components/admin-search";

const primaryOnlyPrefixes = [
  "/agent",
  "/api-keys",
  "/webhooks",
  "/spam-filter",
  "/backups",
  "/branding",
  "/licenses",
  "/activity",
  "/audit-logs",
  "/general",
  "/security",
  "/ai-usage",
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const requirePrimary = primaryOnlyPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  const mobileTitleKey = adminPageTitles[pathname];
  const mobileTitle = mobileTitleKey ? t(mobileTitleKey) : undefined;

  return (
    <AuthGuard requireMailbox requireRole="admin" requirePrimary={requirePrimary}>
      <SidebarProvider expandedWidth={256} mobileOverlay>
      <MailboxProvider>
        <ComposeProvider>
          <MailSearchProvider>
          <ShortcutsProvider>
            <RouteTitle />
          <div className="flex h-dvh flex-col overflow-hidden bg-[#f6f8fc]">
            <SkipToContent />
            <AppTopBar homeHref="/admin" label={t("account.admin")} search={<AdminSearch />} actions={<LicenseIndicator />} />
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)] transition-[grid-template-columns]" style={{ transitionDuration: "var(--sidebar-transition-duration)" }}>
              <SidebarAside>
                <div className="h-full">
                  <AdminNav />
                </div>
                <SidebarResizeBoundary />
              </SidebarAside>
              <div className="flex min-h-0 min-w-0 flex-col md:pb-4 md:pr-4">
                {mobileTitle && <p aria-hidden="true" className="truncate px-5 pb-3 text-lg font-medium text-neutral-900 md:hidden">{mobileTitle}</p>}
                <main id="main-content" tabIndex={-1} className={clsx("focus:outline-none page-flush min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain max-md:rounded-t-3xl max-md:bg-white max-md:pb-24 md:rounded-2xl md:bg-[#f8fafd] md:ring-1 md:ring-[#e3e3e3]/60 px-6 py-8 scrollbar-gutter-stable lg:px-10", mobileTitle && "max-md:[&_h1]:sr-only")}>
                  <div className={clsx("w-full", pathname === "/admin" ? "max-w-[1240px]" : "max-w-3xl")}>{children}</div>
                </main>
              </div>
            </div>
            <FloatingComposer />
          </div>
          </ShortcutsProvider>
          </MailSearchProvider>
        </ComposeProvider>
      </MailboxProvider>
      </SidebarProvider>
    </AuthGuard>
  );
}
