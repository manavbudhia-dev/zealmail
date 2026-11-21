import { getServerTranslator } from "@/lib/i18n/server";
import { TrackingSettings } from "@/components/settings/tracking-settings";

export default async function SettingsTrackingPage() {
	const t = await getServerTranslator();
	return (
		<div className="space-y-6 py-4">
			<h1 className="sr-only">{t("settings.nav.tracking")}</h1>
			<TrackingSettings />
		</div>
	);
}
