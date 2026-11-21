export type OverviewDay = { date: string; sent: number; opens: number; clicks: number };

export type OverviewMessage = {
	messageId: string;
	subject: string | null;
	recipient: string | null;
	opens: number;
	clicks: number;
	lastActivityAt: string | null;
};

export type OverviewFollowUp = { messageId: string; subject: string | null; recipient: string | null; dueAt: string; opens: number };

export type OverviewEvent = {
	kind: "open" | "click";
	at: string;
	messageId: string;
	subject: string | null;
	recipient: string | null;
	client: string | null;
	device: string | null;
	city: string | null;
	country: string | null;
	url: string | null;
	fileName: string | null;
};

export type OverviewFile = { fileName: string; messageId: string; subject: string | null; recipient: string | null; clicks: number; lastClickedAt: string | null; sentAt: string };

/** Everything the Tracking dashboard shows, for the last `days` days. */
export type TrackingOverview = {
	days: number;
	/** Tracked messages sent in the period, and how many of them were opened, clicked or answered. */
	totals: { sent: number; opened: number; clicked: number; replied: number };
	daily: OverviewDay[];
	/** Opened or clicked in the last 48 hours and not answered yet. */
	warm: OverviewMessage[];
	followUps: OverviewFollowUp[];
	activity: OverviewEvent[];
	files: OverviewFile[];
};
