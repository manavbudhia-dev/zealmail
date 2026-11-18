import { authFetch } from "@/lib/auth/client";
import type { SecurityPolicyForm, SecurityPolicyResponse } from "./types";

async function readResponse(response: Response, fallback: string): Promise<SecurityPolicyResponse> {
	const data = (await response.json().catch(() => ({}))) as SecurityPolicyResponse & { error?: string };
	if (!response.ok) throw new Error(data.error ?? fallback);
	return data;
}

export async function loadSecurityPolicy(): Promise<SecurityPolicyResponse> {
	return readResponse(await authFetch("/api/admin/security", { cache: "no-store" }), "Could not load security policies");
}

export async function saveSecurityPolicy(form: SecurityPolicyForm): Promise<SecurityPolicyResponse> {
	return readResponse(await authFetch("/api/admin/security", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(form),
	}), "Could not save security policies");
}

export function toSecurityPolicyForm(response: SecurityPolicyResponse): SecurityPolicyForm {
	const { policy } = response;
	return {
		twoStep: { enforcement: policy.twoStep.enforcement, graceDays: policy.twoStep.graceDays },
		password: { ...policy.password },
		sessionDays: policy.sessionDays,
		externalForwarding: policy.externalForwarding,
	};
}

const rank = { off: 0, admins: 1, all: 2 } as const;

/** Whether saving this form widens 2-step enforcement, which restarts the grace period for newly covered accounts. */
export function widensTwoStep(saved: SecurityPolicyForm["twoStep"]["enforcement"], next: SecurityPolicyForm["twoStep"]["enforcement"]): boolean {
	return rank[next] > rank[saved];
}

export function isValidSecurityPolicyForm(form: SecurityPolicyForm): boolean {
	const int = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
	return int(form.twoStep.graceDays, 0, 90) && int(form.password.minLength, 8, 128) && int(form.sessionDays, 1, 365);
}
