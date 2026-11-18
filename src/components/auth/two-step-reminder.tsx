"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import type { TwoStepStatus } from "@/lib/security/policy-types";
import { isTwoStepSetupPath, TWO_STEP_REMINDER_DISMISSED_KEY, TWO_STEP_SETUP_PATH, twoStepReminderKind } from "./two-step-reminder-utils";

/**
 * Admin → Security requires 2-step verification. During the grace period this floats over the
 * app until dismissed for the browser session; past it, the security page shows it pinned.
 */
export function TwoStepReminder({ status, pathname }: { status: TwoStepStatus; pathname: string }) {
	const { t, locale } = useLanguage();
	const [dismissed, setDismissed] = useState(true);
	const kind = twoStepReminderKind(status);
	const onSetupPage = isTwoStepSetupPath(pathname);

	useEffect(() => {
		try { setDismissed(sessionStorage.getItem(TWO_STEP_REMINDER_DISMISSED_KEY) === "1"); } catch { setDismissed(false); }
	}, []);

	if (!kind) return null;
	if (kind === "grace" && (dismissed || onSetupPage)) return null;
	if (kind === "overdue" && !onSetupPage) return null;

	const date = status.deadline ? new Date(status.deadline * 1000).toLocaleDateString(locale, { dateStyle: "medium" }) : "";
	const dismiss = () => {
		setDismissed(true);
		try { sessionStorage.setItem(TWO_STEP_REMINDER_DISMISSED_KEY, "1"); } catch { /* the reminder simply returns next load */ }
	};

	return <div role={kind === "overdue" ? "alert" : "status"} className="fixed inset-x-4 bottom-4 z-[120] mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-lg sm:inset-x-auto sm:right-6">
		<p className="font-semibold">{t("twoStepRequired.title")}</p>
		<p className="mt-1">{kind === "overdue" ? t("twoStepRequired.overdue") : t("twoStepRequired.grace", { date })}</p>
		{kind === "grace" && <div className="mt-3 flex gap-2">
			<Button asChild size="sm"><Link href={TWO_STEP_SETUP_PATH} onClick={dismiss}>{t("twoStepRequired.setup")}</Link></Button>
			<Button type="button" size="sm" variant="ghost" onClick={dismiss}>{t("twoStepRequired.later")}</Button>
		</div>}
	</div>;
}
