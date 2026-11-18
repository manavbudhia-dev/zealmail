"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchSessionInfo, peekSessionInfo } from "@/hooks/use-current-user";
import type { AuthGuardProps } from "./auth-guard-types";
import { LoadingTransition } from "@/components/loading-transition";
import { saveUserTimeZonePreference } from "@/lib/time/client";
import { TwoStepReminder } from "./two-step-reminder";
import { isTwoStepSetupPath, TWO_STEP_SETUP_PATH } from "./two-step-reminder-utils";
import type { TwoStepStatus } from "@/lib/security/policy-types";

export function AuthGuard({ children, mode = "protected", requireMailbox, requireRole, requirePrimary, requireFeature, allowAuthenticated }: AuthGuardProps) {
	const pathname = usePathname();
	const router = useRouter();
	const [authorized, setAuthorized] = useState(mode === "public");
	const [twoStep, setTwoStep] = useState<TwoStepStatus | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function checkSession() {
			try {
				// Login pages and onboarding change the answer, so only a finished setup is reused across navigations.
				const cached = mode === "protected" ? peekSessionInfo() : null;
				// An overdue answer is always refreshed, so finishing 2-step setup lifts the restriction at once.
				const response = cached && cached.isSetup !== false && cached.hasMailboxes !== false && !cached.twoStep?.overdue
					? cached
					: await fetchSessionInfo({ fresh: true });
				if (cancelled) return;
				if (!response) {
					setAuthorized(true);
					return;
				}

				if (response.status !== 200) {
					if (mode === "protected" && response.status === 401) router.replace("/login");
					else setAuthorized(true);
					return;
				}

				const data = response;
				if (data.user?.id) saveUserTimeZonePreference(data.user.id, data.user.timeZone ?? null);
				if (mode === "public") {
					if (!allowAuthenticated) router.replace("/inbox");
					return;
				}

				if (requireMailbox && data.hasMailboxes === false && data.user?.role === "admin" && data.isSetup === false && pathname !== "/setup") {
					router.replace("/setup");
					return;
				}

				if (pathname === "/setup" && data.isSetup === true) {
					router.replace("/inbox");
					return;
				}

				if (requireRole && data.user?.role !== requireRole) {
					router.replace("/inbox");
					return;
				}

				if (requirePrimary && !data.user?.isPrimaryAdmin) {
					router.replace("/admin");
					return;
				}

				if ((requireFeature === "calendar" && data.user?.calendarEnabled === false)
					|| (requireFeature === "drive" && data.user?.driveEnabled === false)) {
					router.replace("/inbox");
					return;
				}

				// Admin → Security: past the grace period, only the page that sets it up stays usable.
				setTwoStep(data.twoStep ?? null);
				if (data.twoStep?.overdue && !isTwoStepSetupPath(pathname)) {
					router.replace(`${TWO_STEP_SETUP_PATH}?required=2sv`);
					return;
				}

				setAuthorized(true);
			} catch {
				if (!cancelled) setAuthorized(true);
			}
		}

		void checkSession();

		return () => {
			cancelled = true;
		};
	}, [mode, pathname, requireMailbox, requireRole, requirePrimary, requireFeature, allowAuthenticated, router]);

	useEffect(() => {
		const refreshTimeZone = (event: StorageEvent) => {
			if (event.key === "mailflare-user-time-zone") window.location.reload();
		};
		window.addEventListener("storage", refreshTimeZone);
		return () => window.removeEventListener("storage", refreshTimeZone);
	}, []);

	if (mode === "public") return <>{children}</>;
	return <>
		<LoadingTransition ready={authorized}>{children}</LoadingTransition>
		{authorized && twoStep && <TwoStepReminder status={twoStep} pathname={pathname} />}
	</>;
}
