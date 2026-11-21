export type SummaryFrequency = "off" | "daily" | "weekly";

/** What Settings → Tracking shows and edits. Telegram linking has its own endpoints. */
export type TrackingPreferences = {
	/** Real opens after which an unanswered message is due for a follow-up; 0 is off. */
	hotOpenThreshold: number;
	/** Whether this server has a Telegram bot configured at all. */
	telegramAvailable: boolean;
	telegramLinked: boolean;
	telegramOpens: boolean;
	telegramClicks: boolean;
	summaryFrequency: SummaryFrequency;
};

export type TrackingPreferencesPatch = Partial<Pick<TrackingPreferences, "hotOpenThreshold" | "telegramOpens" | "telegramClicks" | "summaryFrequency">>;
