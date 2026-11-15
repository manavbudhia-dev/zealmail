"use client";

import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { readStorage, writeStorage } from "./reorderable-list-utils";

const subscribeNothing = () => () => {};
const hydratedOnClient = () => true;
const hydratedOnServer = () => false;

/** Open/closed state of a menu section, remembered in localStorage. Starts open. */
export function useSectionOpen(storageKey: string): [boolean, () => void] {
	// Storage is read after hydration so the server and first client render agree.
	const hydrated = useSyncExternalStore(subscribeNothing, hydratedOnClient, hydratedOnServer);
	const [toggled, setToggled] = useState<{ key: string; open: boolean } | null>(null);
	const open = toggled?.key === storageKey ? toggled.open : hydrated ? readStorage(storageKey, true) : true;
	function toggle() {
		writeStorage(storageKey, !open);
		setToggled({ key: storageKey, open: !open });
	}
	return [open, toggle];
}

/**
 * Collapsible section label. `caps` (admin) is small uppercase text behind a chevron; `title` (mail
 * folders) is a Workspace-style heading whose chevron only shows on hover.
 */
export function NavSectionHeader({ label, open, onToggle, children, variant = "caps" }: { label: string; open: boolean; onToggle: () => void; children?: ReactNode; variant?: "caps" | "title" }) {
	if (variant === "title") {
		return (
			<div className="group mt-3 flex h-10 shrink-0 items-center justify-between gap-1 pl-2 pr-1">
				<button type="button" onClick={onToggle} aria-expanded={open} className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-full pl-1 pr-3 text-left text-base font-medium text-[#1f1f1f]">
					<ChevronRight className={cn("h-4 w-4 shrink-0 text-[#444746] opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100", open && "rotate-90")} />
					<span className="truncate">{label}</span>
				</button>
				{children}
			</div>
		);
	}
	return (
		<div className="mt-2 flex h-9 shrink-0 items-center justify-between gap-1 ml-3 mr-2 hover:bg-[#e3e5e8] rounded-full pr-2">
			<button type="button" onClick={onToggle} aria-expanded={open} className="flex h-9 min-w-0 flex-1 items-center gap-2 pl-3 pr-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-[#444746] max-md:text-sm">
				<ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
				<span className="truncate">{label}</span>
			</button>
			{children}
		</div>
	);
}
