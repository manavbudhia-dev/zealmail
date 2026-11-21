"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { TrackingPreferences, TrackingPreferencesPatch } from "@/lib/tracking/preferences-types";
import type { ContactEngagement } from "@/lib/tracking/report-utils";
import { formatUserDate } from "@/lib/time/utils";
import {
	HOT_OPEN_THRESHOLD_OPTIONS,
	TELEGRAM_POLL_LIMIT_MS,
	TELEGRAM_POLL_MS,
	checkTelegramLink,
	downloadTrackingCsv,
	filterEngagement,
	loadContactEngagement,
	loadTrackingPreferences,
	saveTrackingPreferences,
	startTelegramLink,
	unlinkTelegram,
} from "./tracking-settings-utils";

const CARD = "rounded-3xl bg-white p-6";
const ROW = "flex items-start gap-3 rounded-xl bg-neutral-50 p-4";
const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" };

export function TrackingSettings() {
	const { t } = useLanguage();
	const [preferences, setPreferences] = useState<TrackingPreferences | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const describeError = useCallback((cause: unknown) => {
		const code = cause instanceof Error ? cause.message : "";
		if (code === "MIGRATION_REQUIRED") return t("settings.compose.migrationRequired");
		if (code === "TELEGRAM_UNAVAILABLE") return t("trackingSettings.telegram.unavailable");
		return t("trackingSettings.saveFailed");
	}, [t]);

	useEffect(() => {
		let active = true;
		void loadTrackingPreferences().then((loaded) => { if (active) setPreferences(loaded); }).catch((cause) => { if (active) setError(describeError(cause)); });
		return () => { active = false; };
	}, [describeError]);

	const handleLinked = useCallback((linked: boolean) => setPreferences((current) => current && { ...current, telegramLinked: linked }), []);
	const handleError = useCallback((cause: unknown) => setError(describeError(cause)), [describeError]);

	function change(patch: TrackingPreferencesPatch) {
		if (!preferences) return;
		const previous = preferences;
		setPreferences({ ...preferences, ...patch });
		setSaving(true);
		setError(null);
		void saveTrackingPreferences(patch)
			.then(setPreferences)
			.catch((cause) => { setPreferences(previous); setError(describeError(cause)); })
			.finally(() => setSaving(false));
	}

	const disabled = !preferences || saving;
	return (
		<div className="space-y-8">
			{error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
			<section className="space-y-4">
				<div>
					<h2 className="text-xl font-semibold text-neutral-900">{t("trackingSettings.alerts.title")}</h2>
					<p className="mt-1 text-sm text-neutral-500">{t("trackingSettings.alerts.description")}</p>
				</div>
				<div className={`${CARD} space-y-3`}>
					<div className={ROW}>
						<span className="flex-1">
							<label htmlFor="tracking-hot-threshold" className="block text-sm font-medium text-neutral-900">{t("trackingSettings.followUp.title")}</label>
							<span className="mt-1 block text-sm text-neutral-500">{t("trackingSettings.followUp.description")}</span>
						</span>
						<Select
							id="tracking-hot-threshold"
							value={String(preferences?.hotOpenThreshold ?? 3)}
							disabled={disabled}
							className="py-1.5 text-sm text-neutral-900"
							onChange={(event) => change({ hotOpenThreshold: Number(event.target.value) })}
						>
							{HOT_OPEN_THRESHOLD_OPTIONS.map((count) => (
								<option key={count} value={count}>{count === 0 ? t("trackingSettings.off") : t("trackingSettings.followUp.times", { count })}</option>
							))}
						</Select>
					</div>
					<TelegramSettings preferences={preferences} disabled={disabled} onChange={change} onLinked={handleLinked} onError={handleError} />
					<div className={ROW}>
						<span className="flex-1">
							<label htmlFor="tracking-summary" className="block text-sm font-medium text-neutral-900">{t("trackingSettings.summary.title")}</label>
							<span className="mt-1 block text-sm text-neutral-500">{t("trackingSettings.summary.description")}</span>
						</span>
						<Select
							id="tracking-summary"
							value={preferences?.summaryFrequency ?? "off"}
							disabled={disabled}
							className="py-1.5 text-sm text-neutral-900"
							onChange={(event) => change({ summaryFrequency: event.target.value as TrackingPreferences["summaryFrequency"] })}
						>
							<option value="off">{t("trackingSettings.off")}</option>
							<option value="daily">{t("trackingSettings.summary.daily")}</option>
							<option value="weekly">{t("trackingSettings.summary.weekly")}</option>
						</Select>
					</div>
				</div>
			</section>
			<ExportSection onError={handleError} />
			<EngagementSection />
		</div>
	);
}

function TelegramSettings({ preferences, disabled, onChange, onLinked, onError }: {
	preferences: TrackingPreferences | null;
	disabled: boolean;
	onChange: (patch: TrackingPreferencesPatch) => void;
	onLinked: (linked: boolean) => void;
	onError: (cause: unknown) => void;
}) {
	const { t } = useLanguage();
	const [linkUrl, setLinkUrl] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const pollStarted = useRef<number>(0);

	// While a link is pending, ask the server (which reads the bot's updates) until the chat shows up.
	useEffect(() => {
		if (!linkUrl) return;
		pollStarted.current = Date.now();
		const timer = setInterval(() => {
			if (Date.now() - pollStarted.current > TELEGRAM_POLL_LIMIT_MS) {
				clearInterval(timer);
				setLinkUrl(null);
				return;
			}
			void checkTelegramLink().then((linked) => {
				if (!linked) return;
				clearInterval(timer);
				setLinkUrl(null);
				onLinked(true);
			}).catch(() => undefined);
		}, TELEGRAM_POLL_MS);
		return () => clearInterval(timer);
	}, [linkUrl, onLinked]);

	async function link() {
		setBusy(true);
		try {
			const { url } = await startTelegramLink();
			setLinkUrl(url);
			window.open(url, "_blank", "noopener,noreferrer");
		} catch (cause) {
			onError(cause);
		} finally {
			setBusy(false);
		}
	}

	async function unlink() {
		setBusy(true);
		try {
			await unlinkTelegram();
			onLinked(false);
		} catch (cause) {
			onError(cause);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="rounded-xl bg-neutral-50 p-4">
			<p className="text-sm font-medium text-neutral-900">{t("trackingSettings.telegram.title")}</p>
			<p className="mt-1 text-sm text-neutral-500">{t("trackingSettings.telegram.description")}</p>
			{preferences && !preferences.telegramAvailable && <p className="mt-3 text-sm text-amber-700">{t("trackingSettings.telegram.unavailable")}</p>}
			{preferences?.telegramAvailable && !preferences.telegramLinked && (
				<div className="mt-3 space-y-2">
					<Button type="button" size="sm" onClick={() => void link()} disabled={busy || disabled}>{t("trackingSettings.telegram.link")}</Button>
					{linkUrl && (
						<p role="status" className="text-sm text-neutral-600">
							{t("trackingSettings.telegram.waiting")}{" "}
							<a href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{t("trackingSettings.telegram.openAgain")}</a>
						</p>
					)}
				</div>
			)}
			{preferences?.telegramAvailable && preferences.telegramLinked && (
				<div className="mt-3 space-y-3">
					<div className="flex flex-wrap items-center gap-3">
						<p className="text-sm text-emerald-700">{t("trackingSettings.telegram.linked")}</p>
						<Button type="button" size="sm" variant="outline" onClick={() => void unlink()} disabled={busy}>{t("trackingSettings.telegram.unlink")}</Button>
					</div>
					<label className="flex items-center justify-between gap-3 text-sm text-neutral-700">
						{t("trackingSettings.telegram.opens")}
						<Switch checked={preferences.telegramOpens} disabled={disabled} onCheckedChange={(telegramOpens) => onChange({ telegramOpens })} aria-label={t("trackingSettings.telegram.opens")} />
					</label>
					<label className="flex items-center justify-between gap-3 text-sm text-neutral-700">
						{t("trackingSettings.telegram.clicks")}
						<Switch checked={preferences.telegramClicks} disabled={disabled} onCheckedChange={(telegramClicks) => onChange({ telegramClicks })} aria-label={t("trackingSettings.telegram.clicks")} />
					</label>
				</div>
			)}
		</div>
	);
}

function ExportSection({ onError }: { onError: (cause: unknown) => void }) {
	const { t } = useLanguage();
	const [busy, setBusy] = useState<"messages" | "activity" | null>(null);
	async function download(type: "messages" | "activity") {
		setBusy(type);
		try {
			await downloadTrackingCsv(type);
		} catch (cause) {
			onError(cause);
		} finally {
			setBusy(null);
		}
	}
	return (
		<section className="space-y-4">
			<div>
				<h2 className="text-xl font-semibold text-neutral-900">{t("trackingSettings.export.title")}</h2>
				<p className="mt-1 text-sm text-neutral-500">{t("trackingSettings.export.description")}</p>
			</div>
			<div className={`${CARD} flex flex-wrap gap-3`}>
				<Button type="button" variant="outline" onClick={() => void download("messages")} disabled={busy !== null}>
					<Download className="mr-2 h-4 w-4" aria-hidden />{t("trackingSettings.export.messages")}
				</Button>
				<Button type="button" variant="outline" onClick={() => void download("activity")} disabled={busy !== null}>
					<Download className="mr-2 h-4 w-4" aria-hidden />{t("trackingSettings.export.activity")}
				</Button>
			</div>
		</section>
	);
}

function EngagementSection() {
	const { t } = useLanguage();
	const [rows, setRows] = useState<ContactEngagement[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [query, setQuery] = useState("");
	useEffect(() => {
		let active = true;
		void loadContactEngagement().then((loaded) => { if (active) setRows(loaded); }).catch(() => { if (active) setFailed(true); });
		return () => { active = false; };
	}, []);
	const visible = rows ? filterEngagement(rows, query).slice(0, 200) : [];
	return (
		<section className="space-y-4">
			<div>
				<h2 className="text-xl font-semibold text-neutral-900">{t("trackingSettings.contacts.title")}</h2>
				<p className="mt-1 text-sm text-neutral-500">{t("trackingSettings.contacts.description")}</p>
			</div>
			<div className={`${CARD} space-y-4`}>
				{rows && rows.length > 0 && (
					<Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("trackingSettings.contacts.filter")} aria-label={t("trackingSettings.contacts.filter")} />
				)}
				{!rows && !failed && <p className="text-sm text-neutral-500">{t("common.loading")}</p>}
				{failed && <p className="text-sm text-red-700">{t("trackingSettings.saveFailed")}</p>}
				{rows && rows.length === 0 && <p className="text-sm text-neutral-500">{t("trackingSettings.contacts.empty")}</p>}
				{visible.length > 0 && (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[560px] text-left text-sm">
							<thead className="text-xs uppercase tracking-wide text-neutral-500">
								<tr>
									<th className="py-2 pr-3 font-medium">{t("trackingSettings.contacts.address")}</th>
									<th className="px-3 py-2 text-right font-medium">{t("trackingSettings.contacts.sent")}</th>
									<th className="px-3 py-2 text-right font-medium">{t("trackingSettings.contacts.opened")}</th>
									<th className="px-3 py-2 text-right font-medium">{t("trackingSettings.contacts.clicks")}</th>
									<th className="px-3 py-2 text-right font-medium">{t("trackingSettings.contacts.replied")}</th>
									<th className="py-2 pl-3 font-medium">{t("trackingSettings.contacts.lastActivity")}</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-neutral-100">
								{visible.map((row) => (
									<tr key={row.address}>
										<td className="max-w-[16rem] truncate py-2 pr-3 text-neutral-900" title={row.address}>{row.address}</td>
										<td className="px-3 py-2 text-right tabular-nums">{row.sent}</td>
										<td className="px-3 py-2 text-right tabular-nums">{row.opened}</td>
										<td className="px-3 py-2 text-right tabular-nums">{row.clicks}</td>
										<td className="px-3 py-2 text-right tabular-nums">{row.replied}</td>
										<td className="py-2 pl-3 text-neutral-500">{row.lastActivityAt ? formatUserDate(row.lastActivityAt, DATE_FORMAT) : "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</section>
	);
}
