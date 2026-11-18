import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { capSessionLifetimes, getSecurityPolicyState, saveSecurityPolicy } from "@/lib/security/policy";
import { getTwoStepStatus, MAX_SESSION_DAYS, MAX_TWO_STEP_GRACE_DAYS, normalizeSecurityPolicy, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH_FLOOR } from "@/lib/security/policy-utils";
import type { SecurityPolicy } from "@/lib/security/policy-types";

const schema = z.object({
	twoStep: z.object({
		enforcement: z.enum(["off", "admins", "all"]),
		graceDays: z.number().int().min(0).max(MAX_TWO_STEP_GRACE_DAYS),
	}),
	password: z.object({
		minLength: z.number().int().min(PASSWORD_MIN_LENGTH_FLOOR).max(PASSWORD_MAX_LENGTH),
		requireLetters: z.boolean(),
		requireNumbers: z.boolean(),
		requireSymbols: z.boolean(),
	}),
	sessionDays: z.number().int().min(1).max(MAX_SESSION_DAYS),
	externalForwarding: z.enum(["allow", "block"]),
});

/** How many active accounts the 2-step rule reaches, and how many are set up or locked out. */
async function twoStepCompliance(env: CloudflareEnv, policy: SecurityPolicy) {
	const rows = await getDb(env)
		.select({ role: users.role, totpEnabled: users.totpEnabled, passkeyCount: users.passkeyCount, createdAt: users.createdAt })
		.from(users)
		.where(and(eq(users.disabled, false), isNull(users.deletedAt)));
	const now = Math.floor(Date.now() / 1000);
	let affected = 0, enrolled = 0, overdue = 0;
	for (const row of rows) {
		const status = getTwoStepStatus(policy, row, now);
		if (!status.required) continue;
		affected += 1;
		if (status.enrolled) enrolled += 1;
		if (status.overdue) overdue += 1;
	}
	return { affected, enrolled, overdue };
}

async function respond(env: CloudflareEnv) {
	const { policy, available } = await getSecurityPolicyState(env);
	// Compliance always counts against both scopes so the page can preview a change before saving.
	const [admins, all] = await Promise.all([
		twoStepCompliance(env, { ...policy, twoStep: { ...policy.twoStep, enforcement: "admins", enforcedAt: policy.twoStep.enforcedAt ?? Math.floor(Date.now() / 1000) } }),
		twoStepCompliance(env, { ...policy, twoStep: { ...policy.twoStep, enforcement: "all", enforcedAt: policy.twoStep.enforcedAt ?? Math.floor(Date.now() / 1000) } }),
	]);
	return Response.json({ policy, available, compliance: { admins, all } }, { headers: { "Cache-Control": "no-store" } });
}

async function authorize(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return { env, error: auth.error } as const;
	if (!isPrimaryAdmin(auth.user)) return { env, error: Response.json({ error: "Forbidden" }, { status: 403 }) } as const;
	return { env, user: auth.user, error: null } as const;
}

export async function GET(request: Request) {
	const access = await authorize(request);
	if (access.error) return access.error;
	return respond(access.env);
}

export async function PUT(request: Request) {
	const access = await authorize(request);
	if (access.error) return access.error;
	if (!hasValidSessionMutationOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
	const { env, user } = access;
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: "Check the security settings and try again" }, { status: 400 });
	const state = await getSecurityPolicyState(env);
	if (!state.available) return Response.json({ error: "Apply the pending database migrations before saving security policies" }, { status: 409 });
	const before = state.policy;
	const saved = await saveSecurityPolicy(env, normalizeSecurityPolicy(parsed.data));
	if (saved.sessionDays < before.sessionDays) await capSessionLifetimes(env, saved.sessionDays);
	await createAuditLog(env, {
		actorUserId: user.id,
		action: "security.policy_updated",
		metadata: {
			twoStep: saved.twoStep.enforcement,
			graceDays: saved.twoStep.graceDays,
			passwordMinLength: saved.password.minLength,
			sessionDays: saved.sessionDays,
			externalForwarding: saved.externalForwarding,
		},
	}).catch(() => undefined);
	return respond(env);
}
