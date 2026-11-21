export type OpenRequestInfo = {
	userAgent: string | null;
	asn?: number;
	country?: string | null;
	city?: string | null;
	sentAt: Date;
	openedAt: Date;
};

export type OpenClassification = {
	client: string | null;
	device: string | null;
	country: string | null;
	city: string | null;
	/** Prefetches by privacy proxies and security scanners, not a person reading. */
	automated: boolean;
};

export type MessageOpenEvent = OpenClassification & {
	openedAt: string;
	/** Whose copy was opened, when the message went out as separate copies. */
	recipient?: string | null;
};

export type MessageTrackingSummary = {
	openCount: number;
	firstOpenedAt: string | null;
	lastOpenedAt: string | null;
	/** True when the only fetches so far were automated, e.g. Apple Mail Privacy Protection. */
	onlyAutomated: boolean;
	opens: MessageOpenEvent[];
	/** Real clicks across all links; a click also proves the message was read. */
	clickCount: number;
	links: MessageLinkSummary[];
	/** One entry per recipient when the message went out as separate copies; empty otherwise. */
	recipients: MessageRecipientTracking[];
};

export type MessageRecipientTracking = {
	recipient: string;
	state: MessageTickState;
	openCount: number;
	clickCount: number;
	lastOpenedAt: string | null;
};

export type ClickRequestInfo = {
	method: string;
	userAgent: string | null;
	country?: string | null;
	city?: string | null;
	sentAt: Date;
	clickedAt: Date;
};

export type MessageLinkSummary = {
	url: string;
	/** Clicks that were not classified as automated. */
	clickCount: number;
	lastClickedAt: string | null;
	/** Fetches by link scanners and other automated clients, not counted above. */
	automatedClicks: number;
};

/** How far a tracked message got, as the list's ticks show it. */
export type MessageTickState = "sent" | "possible" | "opened";

export type MessageTrackingState = {
	state: MessageTickState;
	opens: number;
	clicks: number;
	/** Separate copies only: how many recipients got one, and how many of them opened it or clicked. */
	recipients?: number;
	openedBy?: number;
};
