"use client";

import { cn } from "@/lib/utils";
import { useLanguage } from "./language-provider";
import type { NavLink } from "./components-nav-types";
import { useCurrentUser } from "@/hooks/use-current-user";
import { adminNavSections as sections, canSeeAdminLink } from "./admin-nav-utils";
import { NavItem } from "./components-nav";
import { NavSectionHeader, useSectionOpen } from "./nav-section-header";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarScaffold } from "./sidebar-scaffold";
import { useSidebar } from "./sidebar-state";

function AdminSection({ id, label, links, showDivider, minimal }: { id?: string; label?: string; links: NavLink[]; showDivider: boolean; minimal: boolean }) {
  const [open, toggle] = useSectionOpen(`mailflare:nav:admin-section-open:${id ?? ""}`);
  // Unlabelled sections have nothing to toggle; the icon rail always shows everything.
  const expanded = minimal || !label || open;
  return (
    <section>
      {showDivider && <hr className="mx-6 mb-3 border-neutral-200/70" />}
      {!minimal && label && <NavSectionHeader label={label} open={open} onToggle={toggle} />}
      {expanded && (
        <div className="space-y-px">
          {links.map((link) => (
            <NavItem link={link} key={link.href} />
          ))}
        </div>
      )}
    </section>
  );
}

export function AdminNav({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { minimal, mobile } = useSidebar();
  const user = useCurrentUser();


  return (
    <SidebarScaffold className={className} header={mobile ? <SidebarHeader href="/admin" label={t("account.admin")} /> : undefined} footer={<SidebarFooter />}>
      <div className={cn("space-y-3", minimal && "space-y-2")}>
        {sections.map((section, sectionIndex) => {
          const links = section.links.filter((link) => canSeeAdminLink(link, user)).map(({ labelKey, ...link }): NavLink => ({ ...link, label: t(labelKey) }));
          if (links.length === 0) return null;

          return (
            // The first section has no label, so fall back to its first href for a stable key.
            <AdminSection key={section.id ?? links[0].href} id={section.id} label={section.labelKey ? t(section.labelKey) : undefined} links={links} showDivider={minimal && sectionIndex > 0} minimal={minimal} />
          );
        })}
      </div>
    </SidebarScaffold>
  );
}
