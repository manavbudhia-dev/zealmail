"use client";

import { SkipToContent } from "@/components/skip-to-content";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailSearchInput } from "@/components/mail-search/mail-search-input";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { LicenseIndicator } from "@/components/license-indicator";
import { DashboardNav } from "@/components/dashboard-nav";
import { SidebarProvider } from "@/components/sidebar-state";
import { ShortcutsProvider } from "@/components/shortcuts";
import { SidebarAside } from "@/components/sidebar-aside";
import { AppTopBar } from "@/components/app-top-bar";
import { RouteTitle } from "@/components/route-title";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <SidebarProvider mobileOverlay>
        <MailboxProvider>
          <ComposeProvider>
            <MailSearchProvider>
              <ShortcutsProvider>
                <RouteTitle />
                <div className="flex h-dvh flex-col overflow-hidden bg-[#f6f8fc]">
                  <SkipToContent />
                  <AppTopBar search={<MailSearchInput />} actions={<LicenseIndicator />} />
                  <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)] transition-[grid-template-columns]" style={{ transitionDuration: "var(--sidebar-transition-duration)" }}>
                    <SidebarAside>
                      <DashboardNav />
                    </SidebarAside>
                    <div className="flex min-h-0 min-w-0 flex-col md:pb-4 md:pr-4">
                      <main id="main-content" tabIndex={-1} className="focus:outline-none page-flush min-h-0 flex-1 overflow-y-auto max-md:rounded-t-3xl max-md:bg-white overscroll-contain scrollbar-gutter-stable">
                        {children}
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
