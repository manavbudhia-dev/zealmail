import type { TwoStepStatus } from "@/lib/security/policy-types";

/** Where people set up a passkey or authenticator app. */
export const TWO_STEP_SETUP_PATH = "/settings/security";

/** The only page an account past its 2-step grace period can open. */
export function isTwoStepSetupPath(pathname: string): boolean {
	return pathname === TWO_STEP_SETUP_PATH || pathname.startsWith(`${TWO_STEP_SETUP_PATH}/`);
}

/** Which reminder to show, if any: during the grace period, or the restriction notice once it has passed. */
export function twoStepReminderKind(status: TwoStepStatus): "grace" | "overdue" | null {
	if (!status.required || status.enrolled) return null;
	return status.overdue ? "overdue" : "grace";
}

export const TWO_STEP_REMINDER_DISMISSED_KEY = "zealmail-two-step-reminder-dismissed";
