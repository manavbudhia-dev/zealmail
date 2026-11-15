import { Check } from "@/components/icons";
import { UPSTREAM_SOURCE_URL, ZEALMAIL_SOURCE_URL } from "@/lib/zealmail";

const FEATURES = [
  "Custom branding (name and icon)",
  "Unlimited accounts",
  "Shared mailboxes, delegation and booking hosts",
  "Account forwarding and admin account management",
];

/** ZealMail has no license tiers: every feature is unlocked. */
export default function LicensesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-medium text-neutral-900">All features unlocked</h1>
        <p className="mt-2 text-sm text-neutral-500">ZealMail includes every Pro and Team feature. No license key is needed.</p>
      </div>
      <div className="rounded-3xl bg-white p-6">
        <ul className="space-y-3 text-sm text-neutral-700">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              {feature}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-neutral-500">
          ZealMail is a modified version of{" "}
          <a href={UPSTREAM_SOURCE_URL} target="_blank" rel="noreferrer" className="underline">Mailflare</a>
          , licensed under the GNU AGPL v3.{" "}
          <a href={ZEALMAIL_SOURCE_URL} target="_blank" rel="noreferrer" className="underline">Source code</a>
        </p>
      </div>
    </div>
  );
}
