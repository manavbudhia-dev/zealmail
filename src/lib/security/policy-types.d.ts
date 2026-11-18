/** Who must have 2-step verification (TOTP or a passkey). */
export type TwoStepEnforcement = "off" | "admins" | "all";

export interface SecurityPolicy {
	twoStep: {
		enforcement: TwoStepEnforcement;
		/** Days a user has to set up 2-step verification once it starts applying to them. */
		graceDays: number;
		/**
		 * Unix seconds when the current enforcement started. The grace period runs from this or
		 * from the account's creation, whichever is later. Null while enforcement is off.
		 */
		enforcedAt: number | null;
	};
	password: {
		minLength: number;
		requireLetters: boolean;
		requireNumbers: boolean;
		requireSymbols: boolean;
	};
	/** Days a sign-in lasts before the user is signed out automatically. */
	sessionDays: number;
	/** Whether account-level automatic forwarding may target addresses outside the installation's domains. */
	externalForwarding: "allow" | "block";
}

export type PasswordPolicyFailure = "too_short" | "too_long" | "letters" | "numbers" | "symbols";

export interface TwoStepStatus {
	/** The policy applies to this account. */
	required: boolean;
	/** The account has TOTP or a passkey. */
	enrolled: boolean;
	/** Unix seconds after which an unenrolled account is restricted to setting it up; null when not required. */
	deadline: number | null;
	/** Required, not enrolled, and past the deadline. */
	overdue: boolean;
}
