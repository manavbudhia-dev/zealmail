"use client";

import packageJson from "../../package.json";
import { UPSTREAM_SOURCE_URL, ZEALMAIL_SOURCE_URL } from "@/lib/zealmail";
import { useSidebar } from "./sidebar-state";
import { useLanguage } from "./language-provider";
import { SidebarStorageMeter } from "./sidebar-storage-meter";

export function SidebarFooter() {
	const { minimal } = useSidebar();
	if (minimal) return null;

	// Help and keyboard shortcuts live in the top bar; the menu foot keeps storage and the source credit.
	return (
		<div className="flex flex-col gap-1 pt-2">
			<SidebarStorageMeter />
			<PoweredBy className="px-3" />
		</div>
	);
}

/** The "ZealMail vX, based on Mailflare" credit and source link, shared by the mail and Drive sidebars. */
export function PoweredBy({ className = "px-1" }: { className?: string }) {
	const { t } = useLanguage();
	return (
      <p className={`${className} text-[11px] text-neutral-500`}>
        <a href={ZEALMAIL_SOURCE_URL} target="_blank" className="hover:underline text-neutral-500" rel="noreferrer">
          ZealMail v{packageJson.version}
        </a>
        {" · based on "}
        <a href={UPSTREAM_SOURCE_URL} target="_blank" className="hover:underline text-neutral-500" rel="noreferrer">
          Mailflare
        </a>
        {" (AGPL)"}
      </p>
	);
}
