import type { PasswordPolicyFailure, SecurityPolicy, TwoStepEnforcement, TwoStepStatus } from "./policy-types";

export const PASSWORD_MIN_LENGTH_FLOOR = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const DEFAULT_SESSION_DAYS = 30;
export const MAX_SESSION_DAYS = 365;
export const MAX_TWO_STEP_GRACE_DAYS = 90;

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
	twoStep: { enforcement: "off", graceDays: 7, enforcedAt: null },
	password: { minLength: PASSWORD_MIN_LENGTH_FLOOR, requireLetters: false, requireNumbers: false, requireSymbols: false },
	sessionDays: DEFAULT_SESSION_DAYS,
	externalForwarding: "allow",
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

function isEnforcement(value: unknown): value is TwoStepEnforcement {
	return value === "off" || value === "admins" || value === "all";
}

/** Reads a stored policy, filling anything missing or invalid from the defaults so a bad row never locks people out. */
export function parseSecurityPolicy(value: string | null | undefined): SecurityPolicy {
	if (!value) return structuredClone(DEFAULT_SECURITY_POLICY);
	let raw: Record<string, unknown>;
	try {
		const parsed = JSON.parse(value);
		raw = parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return structuredClone(DEFAULT_SECURITY_POLICY);
	}
	return normalizeSecurityPolicy(raw);
}

export function normalizeSecurityPolicy(raw: Record<string, unknown>): SecurityPolicy {
	const defaults = DEFAULT_SECURITY_POLICY;
	const twoStep = (raw.twoStep && typeof raw.twoStep === "object" ? raw.twoStep : {}) as Record<string, unknown>;
	const password = (raw.password && typeof raw.password === "object" ? raw.password : {}) as Record<string, unknown>;
	const enforcement = isEnforcement(twoStep.enforcement) ? twoStep.enforcement : defaults.twoStep.enforcement;
	const enforcedAt = typeof twoStep.enforcedAt === "number" && Number.isFinite(twoStep.enforcedAt) ? Math.floor(twoStep.enforcedAt) : null;
	return {
		twoStep: {
			enforcement,
			graceDays: clampInt(twoStep.graceDays, 0, MAX_TWO_STEP_GRACE_DAYS, defaults.twoStep.graceDays),
			enforcedAt: enforcement === "off" ? null : enforcedAt ?? 0,
		},
		password: {
			minLength: clampInt(password.minLength, PASSWORD_MIN_LENGTH_FLOOR, PASSWORD_MAX_LENGTH, defaults.password.minLength),
			requireLetters: password.requireLetters === true,
			requireNumbers: password.requireNumbers === true,
			requireSymbols: password.requireSymbols === true,
		},
		sessionDays: clampInt(raw.sessionDays, 1, MAX_SESSION_DAYS, defaults.sessionDays),
		externalForwarding: raw.externalForwarding === "block" ? "block" : "allow",
	};
}

const enforcementRank: Record<TwoStepEnforcement, number> = { off: 0, admins: 1, all: 2 };

/**
 * Applies an administrator's edit. The grace period restarts only when enforcement newly
 * reaches people (off → on, admins → all); narrowing it or changing other fields keeps the
 * existing deadline so it cannot be pushed back by accident.
 */
export function mergeSecurityPolicy(current: SecurityPolicy, next: SecurityPolicy, nowSeconds: number): SecurityPolicy {
	const widened = enforcementRank[next.twoStep.enforcement] > enforcementRank[current.twoStep.enforcement];
	const enforcedAt = next.twoStep.enforcement === "off"
		? null
		: widened || current.twoStep.enforcedAt === null ? nowSeconds : current.twoStep.enforcedAt;
	return { ...next, twoStep: { ...next.twoStep, enforcedAt } };
}

/** Every rule the password breaks; empty when it satisfies the policy. */
export function checkPassword(policy: SecurityPolicy["password"], password: string): PasswordPolicyFailure[] {
	const failures: PasswordPolicyFailure[] = [];
	const length = [...password].length;
	if (length < policy.minLength) failures.push("too_short");
	if (length > PASSWORD_MAX_LENGTH) failures.push("too_long");
	if (policy.requireLetters && !/\p{L}/u.test(password)) failures.push("letters");
	if (policy.requireNumbers && !/\p{N}/u.test(password)) failures.push("numbers");
	if (policy.requireSymbols && !/[^\p{L}\p{N}\s]/u.test(password)) failures.push("symbols");
	return failures;
}

/** A single sentence for API errors, listing everything the password is missing. */
export function describePasswordFailures(policy: SecurityPolicy["password"], failures: PasswordPolicyFailure[]): string {
	if (failures.includes("too_long")) return `Passwords can be at most ${PASSWORD_MAX_LENGTH} characters.`;
	const parts: string[] = [];
	if (failures.includes("too_short")) parts.push(`at least ${policy.minLength} characters`);
	if (failures.includes("letters")) parts.push("a letter");
	if (failures.includes("numbers")) parts.push("a number");
	if (failures.includes("symbols")) parts.push("a symbol");
	if (!parts.length) return "";
	const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
	return `Your organization requires passwords with ${list}.`;
}

type TwoStepAccount = { role: string; totpEnabled: boolean; passkeyCount: number; createdAt: Date | number | null };

function toSeconds(value: Date | number | null): number {
	if (value instanceof Date) return Math.floor(value.getTime() / 1000);
	return typeof value === "number" ? value : 0;
}

export function getTwoStepStatus(policy: SecurityPolicy, account: TwoStepAccount, nowSeconds: number): TwoStepStatus {
	const enrolled = account.totpEnabled || account.passkeyCount > 0;
	const { enforcement, graceDays, enforcedAt } = policy.twoStep;
	const required = enforcement === "all" || (enforcement === "admins" && account.role === "admin");
	if (!required) return { required: false, enrolled, deadline: null, overdue: false };
	const start = Math.max(enforcedAt ?? 0, toSeconds(account.createdAt));
	const deadline = start + graceDays * 86_400;
	return { required, enrolled, deadline, overdue: !enrolled && nowSeconds >= deadline };
}

/** The domain part of an address, lowercased, or null when there is none. */
export function addressDomain(address: string): string | null {
	const match = address.trim().match(/<([^>]+)>\s*$/);
	const bare = (match ? match[1] : address).trim().toLowerCase();
	const at = bare.lastIndexOf("@");
	if (at < 1 || at === bare.length - 1) return null;
	return bare.slice(at + 1).replace(/\.$/, "");
}

/** Whether a forwarding address falls outside the given hostnames (subdomains of a listed host count as inside). */
export function isExternalAddress(address: string, internalHostnames: Iterable<string>): boolean {
	const domain = addressDomain(address);
	if (!domain) return true;
	for (const host of internalHostnames) {
		const hostname = host.trim().toLowerCase().replace(/\.$/, "");
		if (!hostname) continue;
		if (domain === hostname || domain.endsWith(`.${hostname}`)) return false;
	}
	return true;
}
