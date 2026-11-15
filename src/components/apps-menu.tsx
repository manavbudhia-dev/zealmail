"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { useDismissible } from "@/components/use-dismissible";
import { MaterialApps } from "./material-icons";
import { Tooltip } from "./ui/tooltip";
import { getWorkspaceApps } from "./workspace-apps-utils";
import type { AppsMenuProps } from "./mailbox-selector-types";

export function AppsMenu({ user }: AppsMenuProps) {
	const { t } = useLanguage();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismissible(open, () => setOpen(false), ref);
	const items = getWorkspaceApps(user);

	return (
		<div ref={ref} className="relative">
			<Tooltip label={t("account.apps")}>
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					className={`flex h-10 w-10 items-center justify-center rounded-full text-[#444746] transition-colors hover:bg-[#e8eaed] ${open ? "bg-[#e8eaed]" : ""}`}
					aria-label={t("account.openApps")}
					aria-expanded={open}
				>
					<MaterialApps size={24} />
				</button>
			</Tooltip>
			{open && (
				<div className="absolute right-0 top-12 z-90 w-[328px] max-w-[calc(100vw-1rem)] rounded-[28px] bg-[#e9eef6] p-2 shadow-[0_4px_8px_3px_rgba(60,64,67,0.15),0_1px_3px_rgba(60,64,67,0.3)]">
					<div className="grid grid-cols-3 gap-1 rounded-[24px] bg-white p-3">
						{items.map(({ href, labelKey, icon: Icon, tint, color }) => (
							<Link
								key={href}
								href={href}
								onClick={() => setOpen(false)}
								className="flex flex-col items-center gap-2 rounded-2xl px-1 py-3 text-center text-[13px] text-[#1f1f1f] transition-colors hover:bg-[#e8f0fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]"
							>
								<span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: tint, color }}>
									<Icon size={24} strokeWidth={1.8} />
								</span>
								<span className="w-full truncate">{t(labelKey)}</span>
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
