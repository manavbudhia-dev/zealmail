"use client";

import Link from "next/link";
import { Sparkles } from "@/components/icons";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useLanguage } from "./language-provider";
import { Tooltip } from "./ui/tooltip";
import { getWorkspaceApps } from "./workspace-apps-utils";

/**
 * The narrow rail on the right of the mail view with shortcuts to the other apps, like the
 * Workspace side panel. The assistant toggle sits at the end when the assistant is available.
 */
export function AppSideRail({ assistantEnabled, assistantOpen, onToggleAssistant }: { assistantEnabled: boolean; assistantOpen: boolean; onToggleAssistant: () => void }) {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const apps = getWorkspaceApps(user).filter((app) => app.id !== "mail" && app.id !== "admin");

	return (
		<aside aria-label={t("navigation.sidePanel")} className="hidden w-14 shrink-0 flex-col items-center gap-3 pt-2 lg:flex">
			{apps.map(({ href, labelKey, icon: Icon, tint, color }) => (
				<Tooltip key={href} label={t(labelKey)}>
					<Link href={href} aria-label={t(labelKey)} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[#e8eaed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]">
						<span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: tint, color }}>
							<Icon size={18} strokeWidth={2} />
						</span>
					</Link>
				</Tooltip>
			))}
			{assistantEnabled && (
				<>
					<hr className="w-5 border-[#c4c7c5]" />
					<Tooltip label={assistantOpen ? t("agent.assistant.close") : t("agent.assistant.open")}>
						<button
							type="button"
							onClick={onToggleAssistant}
							aria-label={assistantOpen ? t("agent.assistant.close") : t("agent.assistant.open")}
							aria-expanded={assistantOpen}
							aria-controls="email-assistant-panel"
							className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[#e8eaed] ${assistantOpen ? "bg-[#d3e3fd] text-[#0b57d0]" : "text-[#444746]"}`}
						>
							<Sparkles size={20} />
						</button>
					</Tooltip>
				</>
			)}
		</aside>
	);
}
