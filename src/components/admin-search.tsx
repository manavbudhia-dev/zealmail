"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/use-current-user";
import { HeaderSearch } from "./header-search";
import { useLanguage } from "./language-provider";
import { adminNavSections, canSeeAdminLink } from "./admin-nav-utils";

/** The admin app bar search: finds admin pages by name or section and opens the chosen one. */
export function AdminSearch() {
	const { t } = useLanguage();
	const router = useRouter();
	const user = useCurrentUser();
	const [query, setQuery] = useState("");
	const [highlight, setHighlight] = useState(0);

	const pages = useMemo(() => adminNavSections.flatMap((section) =>
		section.links
			.filter((link) => canSeeAdminLink(link, user))
			.map((link) => ({ ...link, label: t(link.labelKey), section: section.labelKey ? t(section.labelKey) : "" })),
	), [t, user]);

	const needle = query.trim().toLowerCase();
	const results = needle ? pages.filter((page) => page.label.toLowerCase().includes(needle) || page.section.toLowerCase().includes(needle)) : [];
	const active = Math.min(highlight, Math.max(0, results.length - 1));

	function open(href: string) {
		setQuery("");
		setHighlight(0);
		router.push(href);
	}

	return (
		<div
			className="relative flex min-w-0 max-w-[840px] flex-1"
			onKeyDown={(event) => {
				if (!results.length) return;
				if (event.key === "ArrowDown") { event.preventDefault(); setHighlight((active + 1) % results.length); }
				if (event.key === "ArrowUp") { event.preventDefault(); setHighlight((active - 1 + results.length) % results.length); }
				if (event.key === "Escape") setQuery("");
			}}
		>
			<HeaderSearch
				value={query}
				onChange={(value) => { setQuery(value); setHighlight(0); }}
				label={t("admin.search.placeholder")}
				mobileEnd
				onSubmit={() => { if (results[active]) open(results[active].href); }}
				inputProps={{ role: "combobox", "aria-expanded": String(!!needle), "aria-controls": "admin-search-results", autoComplete: "off" }}
			/>
			{needle && (
				<ul id="admin-search-results" role="listbox" className="absolute inset-x-0 top-full z-[70] mt-1 overflow-hidden rounded-2xl bg-white py-2 shadow-[0_4px_8px_3px_rgba(60,64,67,0.15),0_1px_3px_rgba(60,64,67,0.3)] max-md:fixed max-md:inset-x-2 max-md:top-16">
					{results.length === 0 && <li className="px-5 py-3 text-sm text-[#5f6368]">{t("admin.search.noResults")}</li>}
					{results.map(({ href, label, section, icon: Icon }, index) => (
						<li key={href} role="option" aria-selected={index === active}>
							<button
								type="button"
								onMouseDown={(event) => event.preventDefault()}
								onMouseEnter={() => setHighlight(index)}
								onClick={() => open(href)}
								className={`flex w-full items-center gap-4 px-5 py-2.5 text-left text-sm ${index === active ? "bg-[#e8f0fe]" : ""}`}
							>
								<Icon size={20} strokeWidth={1.75} className="shrink-0 text-[#444746]" />
								<span className="min-w-0 flex-1 truncate text-[#1f1f1f]">{label}</span>
								{section && <span className="shrink-0 text-xs text-[#5f6368]">{section}</span>}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
