"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useDismissible } from "@/components/use-dismissible";
import { MaterialArrowDropDown, MaterialMoreVert } from "@/components/material-icons";
import { Tooltip } from "@/components/ui/tooltip";

type MenuItem = { label: string; onSelect: () => void; disabled?: boolean };

/** A small Gmail-style popup menu anchored under its trigger. */
function ToolbarMenu({ label, trigger, items, triggerClassName }: { label: string; trigger: ReactNode; items: MenuItem[]; triggerClassName: string }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismissible(open, () => setOpen(false), ref);
	return (
		<div ref={ref} className="relative">
			<Tooltip label={label}>
				<button type="button" onClick={() => setOpen((value) => !value)} aria-label={label} aria-haspopup="menu" aria-expanded={open} className={`${triggerClassName} ${open ? "bg-[#e8eaed]" : ""}`}>
					{trigger}
				</button>
			</Tooltip>
			{open && (
				<div role="menu" className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-md bg-white py-2 shadow-[0_2px_2px_0_rgba(0,0,0,0.14),0_3px_1px_-2px_rgba(0,0,0,0.12),0_1px_5px_0_rgba(0,0,0,0.2)]">
					{items.map((item) => (
						<button
							key={item.label}
							type="button"
							role="menuitem"
							disabled={item.disabled}
							onClick={() => { setOpen(false); item.onSelect(); }}
							className="block w-full px-4 py-1.5 text-left text-sm text-[#1f1f1f] hover:bg-[#f1f3f4] disabled:cursor-default disabled:text-[#9aa0a6] disabled:hover:bg-transparent"
						>
							{item.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export function SelectionMenu({ label, items }: { label: string; items: MenuItem[] }) {
	return <ToolbarMenu label={label} items={items} trigger={<MaterialArrowDropDown size={20} />} triggerClassName="-ml-2 flex h-8 w-5 items-center justify-center rounded text-[#444746] hover:bg-[#e8eaed]" />;
}

export function MoreActionsMenu({ label, items }: { label: string; items: MenuItem[] }) {
	return <ToolbarMenu label={label} items={items} trigger={<MaterialMoreVert size={20} />} triggerClassName="flex h-10 w-10 items-center justify-center rounded-full text-[#444746] hover:bg-[#e8eaed]" />;
}
