import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, domains, sessions } from "@/db/schema";
import { isMissingColumnError, isMissingTableError } from "@/lib/database-errors";
import type { SecurityPolicy } from "./policy-types";
import { checkPassword, describePasswordFailures, DEFAULT_SECURITY_POLICY, isExternalAddress, mergeSecurityPolicy, parseSecurityPolicy } from "./policy-utils";

const SETTINGS_ID = "default";
// Sign-in, password changes and every inbound message read the policy; a short per-isolate
// cache keeps that to one query every few seconds. Saving clears it on the isolate that saved.
const CACHE_MS = 10_000;
let cached: { policy: SecurityPolicy; available: boolean; at: number } | null = null;

async function readPolicy(env: CloudflareEnv): Promise<{ policy: SecurityPolicy; available: boolean }> {
	if (cached && Date.now() - cached.at < CACHE_MS) return cached;
	let result: { policy: SecurityPolicy; available: boolean };
	try {
		const [row] = await getDb({ DB: env.DB_PRIMARY ?? env.DB })
			.select({ securityPolicy: appSettings.securityPolicy })
			.from(appSettings)
			.where(eq(appSettings.id, SETTINGS_ID))
			.limit(1);
		result = { policy: parseSecurityPolicy(row?.securityPolicy), available: true };
	} catch (error) {
		// Before migration 0088 (or setup) there is no column: run on the defaults, which match the old behaviour.
		if (!isMissingColumnError(error) && !isMissingTableError(error)) throw error;
		result = { policy: structuredClone(DEFAULT_SECURITY_POLICY), available: false };
	}
	cached = { ...result, at: Date.now() };
	return result;
}

export async function getSecurityPolicy(env: CloudflareEnv): Promise<SecurityPolicy> {
	return (await readPolicy(env)).policy;
}

/** The policy plus whether it can be saved yet (migration 0088). */
export async function getSecurityPolicyState(env: CloudflareEnv) {
	return readPolicy(env);
}

export async function saveSecurityPolicy(env: CloudflareEnv, next: SecurityPolicy): Promise<SecurityPolicy> {
	cached = null;
	const current = (await readPolicy(env)).policy;
	const merged = mergeSecurityPolicy(current, next, Math.floor(Date.now() / 1000));
	const set = { securityPolicy: JSON.stringify(merged), updatedAt: new Date() };
	await getDb(env).insert(appSettings).values({ id: SETTINGS_ID, ...set }).onConflictDoUpdate({ target: appSettings.id, set });
	cached = null;
	return merged;
}

/**
 * Ends sessions older than the policy allows by moving their expiry to creation + lifetime.
 * Timestamps are seconds in every dialect, so the arithmetic is portable.
 */
export async function capSessionLifetimes(env: CloudflareEnv, sessionDays: number): Promise<void> {
	const seconds = Math.round(sessionDays * 86_400);
	const cap = sql`${sessions.createdAt} + ${seconds}`;
	await getDb(env).update(sessions).set({ expiresAt: cap as unknown as Date }).where(sql`${sessions.expiresAt} > ${cap}`);
}

/** Null when the password satisfies the organization's policy, otherwise a message for the user. */
export async function getPasswordPolicyError(env: CloudflareEnv, password: string): Promise<string | null> {
	const { password: rules } = await getSecurityPolicy(env);
	const failures = checkPassword(rules, password);
	return failures.length ? describePasswordFailures(rules, failures) : null;
}

export function passwordPolicyResponse(message: string): Response {
	return Response.json({ error: message, code: "password_policy" }, { status: 400 });
}

/** Session lifetime in milliseconds under the current policy. */
export async function getSessionLifetimeMs(env: CloudflareEnv): Promise<number> {
	return (await getSecurityPolicy(env)).sessionDays * 86_400_000;
}

async function listInternalHostnames(env: CloudflareEnv): Promise<string[]> {
	const rows = await getDb(env).select({ hostname: domains.hostname }).from(domains);
	return rows.map((row) => row.hostname);
}

/** Whether automatic forwarding to this address is allowed by the policy. */
export async function isForwardingAllowed(env: CloudflareEnv, address: string): Promise<boolean> {
	const policy = await getSecurityPolicy(env);
	if (policy.externalForwarding === "allow") return true;
	return !isExternalAddress(address, await listInternalHostnames(env));
}

export const EXTERNAL_FORWARDING_BLOCKED_MESSAGE = "Your organization does not allow automatic forwarding to addresses outside its domains.";

/** A 403 response when a new forwarding address is blocked, or null when it may be saved. */
export async function checkForwardingAddress(env: CloudflareEnv, address: string | null | undefined): Promise<Response | null> {
	if (!address?.trim()) return null;
	if (await isForwardingAllowed(env, address)) return null;
	return Response.json({ error: EXTERNAL_FORWARDING_BLOCKED_MESSAGE, code: "external_forwarding_blocked" }, { status: 403 });
}
