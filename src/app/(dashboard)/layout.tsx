"use client";

import { SkipToContent } from "@/components/skip-to-content";
import { useEffect } from "react";
import {  Sparkles } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailSearchInput } from "@/components/mail-search/mail-search-input";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { AgentPanel } from "@/components/agent/agent-panel";
import { AssistantOpenContext } from "@/components/agent/assistant-open-state";
import { Button } from "@/components/ui/button";
import { DnsSkippedBanner } from "@/components/dns-skipped-banner";
import { LicenseIndicator } from "@/components/license-indicator";
import { DashboardNav } from "@/components/dashboard-nav";
import { SidebarProvider } from "@/components/sidebar-state";
import { SidebarAside } from "@/components/sidebar-aside";
import { AppTopBar } from "@/components/app-top-bar";
import { AppSideRail } from "@/components/app-side-rail";
import { SidebarResizeBoundary } from "@/components/sidebar-resize-boundary";
import { ShortcutsProvider } from "@/components/shortcuts";
import clsx from "clsx";
import { usePathname } from "next/navigation";
import { useDashboardState } from "./dashboard-state";
import { useAssistantAvailability } from "./use-assistant-availability";
import { RouteTitle } from "@/components/route-title";
import { useAppBadge } from "@/hooks/use-app-badge";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const pathname = usePathname();
  // Contacts is a list page like Mailboxes: gray page, white rows, no white panel.
  const listPage = pathname === "/contacts" || pathname.startsWith("/contacts/");
  const { assistantOpen, setAssistantOpen, assistantFullSize, setAssistantFullSize } = useDashboardState();
  const assistantEnabled = useAssistantAvailability();
  const assistantVisible = assistantEnabled === true && assistantOpen;
  useAppBadge();
  const toggleAssistant = () => { setAssistantOpen((current) => !current); setAssistantFullSize(false); };

  useEffect(() => {
    if (assistantEnabled === false && (assistantOpen || assistantFullSize)) {
      setAssistantOpen(false);
      setAssistantFullSize(false);
    }
  }, [assistantEnabled, assistantOpen, assistantFullSize, setAssistantOpen, setAssistantFullSize]);

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
                  <AppTopBar
                    search={<MailSearchInput mobileEnd />}
                    actions={<>
                      <LicenseIndicator />
                      {assistantEnabled && <Button type="button" variant="ghost" size="sm" className={clsx("lg:hidden", assistantOpen ? "bg-blue-50 text-blue-700" : "text-neutral-600")} onClick={toggleAssistant} aria-label={assistantOpen ? t("agent.assistant.close") : t("agent.assistant.open")} aria-expanded={assistantOpen} aria-controls="email-assistant-panel"><Sparkles className="h-5 w-5" /></Button>}
                    </>}
                  />
                  <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] transition-[grid-template-columns] md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]" style={{ transitionDuration: "var(--sidebar-transition-duration)" }}>
                    <SidebarAside>
                      <div className="h-full">
                        <DashboardNav />
                      </div>
                      <SidebarResizeBoundary />
                    </SidebarAside>
                    <div className="flex min-h-0 min-w-0 flex-col">
                      <DnsSkippedBanner />
                      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden md:pb-4 md:pr-4 lg:pr-0">
                        <AssistantOpenContext.Provider value={assistantVisible}>
                          <main id="main-content" tabIndex={-1} className={clsx("focus:outline-none page-flush min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-stable", listPage ? "md:rounded-2xl max-md:rounded-t-3xl max-md:bg-white max-md:pb-24" : "rounded-t-3xl bg-white md:rounded-2xl")} aria-hidden={assistantVisible && assistantFullSize} inert={assistantVisible && assistantFullSize}>
                            {children}
                          </main>
                        </AssistantOpenContext.Provider>
                        <aside className={clsx(assistantFullSize ? "pl-0" : "pl-4", `min-h-0 min-w-0 shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out motion-reduce:transition-none max-md:p-0`, assistantVisible ? "" : "opacity-0")} style={{ width: assistantVisible ? assistantFullSize ? "100%" : "min(390px, 100%)" : "0px" }} aria-hidden={!assistantVisible} inert={!assistantVisible}>
                          {assistantEnabled && <AgentPanel open={assistantVisible} fullSize={assistantFullSize} onToggleFullSize={() => setAssistantFullSize((current) => !current)} onClose={() => { setAssistantOpen(false); setAssistantFullSize(false); }} />}
                        </aside>
                        <AppSideRail assistantEnabled={assistantEnabled === true} assistantOpen={assistantOpen} onToggleAssistant={toggleAssistant} />
                      </div>
                    </div>
                  </div>
                  <FloatingComposer showButton />
                </div>
              </ShortcutsProvider>
            </MailSearchProvider>
          </ComposeProvider>
        </MailboxProvider>
      </SidebarProvider>
    </AuthGuard>
  );
}
