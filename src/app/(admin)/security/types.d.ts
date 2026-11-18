import type { SecurityPolicy } from "@/lib/security/policy-types";

export type TwoStepCompliance = { affected: number; enrolled: number; overdue: number };

export interface SecurityPolicyResponse {
	policy: SecurityPolicy;
	/** False until migration 0088 adds the column; the page is read-only until then. */
	available: boolean;
	/** Counted against each scope, so a change can be previewed before saving. */
	compliance: { admins: TwoStepCompliance; all: TwoStepCompliance };
}

/** What the page edits: the policy without the server-managed `enforcedAt`. */
export type SecurityPolicyForm = Omit<SecurityPolicy, "twoStep"> & { twoStep: Omit<SecurityPolicy["twoStep"], "enforcedAt"> };
