import type { ReactNode } from "react";

export type AppTopBarProps = {
	/** Where the logo links to. */
	homeHref?: string;
	/** Shown after the product name in a lighter weight, e.g. "Admin". */
	label?: string;
	/** The search field; when absent the bar keeps an empty flexible gap instead. */
	search?: ReactNode;
	/** Extra controls placed before the help and settings buttons. */
	actions?: ReactNode;
};
