"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth/client";
import { formatDriveSize } from "@/lib/drive/utils";
import { DRIVE_STORAGE_EVENT, type DriveStorageDetail } from "@/app/(drive)/drive-events";
import { useLanguage } from "./language-provider";
import { MaterialCloud } from "./material-icons";

let cachedUsage: DriveStorageDetail | null = null;

/** "2.1 GB of 15 GB used" with a bar, from the account's Drive usage. Renders nothing when Drive is off. */
export function SidebarStorageMeter() {
	const { t } = useLanguage();
	const [usage, setUsage] = useState<DriveStorageDetail | null>(cachedUsage);

	useEffect(() => {
		let active = true;
		void authFetch("/api/drive/usage")
			.then(async (response) => (response.ok ? ((await response.json()) as DriveStorageDetail) : null))
			.then((next) => {
				cachedUsage = next;
				if (active) setUsage(next);
			})
			.catch(() => undefined);
		function onStorage(event: Event) {
			const detail = (event as CustomEvent<DriveStorageDetail>).detail;
			if (!detail) return;
			cachedUsage = detail;
			setUsage(detail);
		}
		window.addEventListener(DRIVE_STORAGE_EVENT, onStorage);
		return () => {
			active = false;
			window.removeEventListener(DRIVE_STORAGE_EVENT, onStorage);
		};
	}, []);

	if (!usage) return null;
	const percent = usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;

	return (
		<Link href="/drive" className="block rounded-xl px-3 py-2 text-[#444746] transition-colors hover:bg-[#e8eaed]/70">
			<span className="flex items-center gap-2 text-xs">
				<MaterialCloud size={18} className="shrink-0" />
				<span className="truncate">
					{usage.limit
						? t("drive.storageOf", { used: formatDriveSize(usage.used), total: formatDriveSize(usage.limit) })
						: t("drive.storageUsed", { size: formatDriveSize(usage.used) })}
				</span>
			</span>
			{usage.limit && (
				<span role="progressbar" aria-label={t("drive.storageBar")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-2 block h-1 overflow-hidden rounded-full bg-[#dde3ea]">
					<span className={`block h-full rounded-full ${percent >= 90 ? "bg-[#d93025]" : "bg-[#0b57d0]"}`} style={{ width: `${Math.max(percent, 2)}%` }} />
				</span>
			)}
		</Link>
	);
}
