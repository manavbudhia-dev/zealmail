"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TranslationKey } from "@/lib/i18n/types";
import type { SecurityPolicyForm, SecurityPolicyResponse } from "./types";
import { isValidSecurityPolicyForm, loadSecurityPolicy, saveSecurityPolicy, toSecurityPolicyForm, widensTwoStep } from "./utils";

const twoStepOptions: Array<{ value: SecurityPolicyForm["twoStep"]["enforcement"]; labelKey: TranslationKey }> = [
	{ value: "off", labelKey: "securityPolicy.twoStepOff" },
	{ value: "admins", labelKey: "securityPolicy.twoStepAdmins" },
	{ value: "all", labelKey: "securityPolicy.twoStepAll" },
];

const forwardingOptions: Array<{ value: SecurityPolicyForm["externalForwarding"]; labelKey: TranslationKey }> = [
	{ value: "allow", labelKey: "securityPolicy.forwardingAllow" },
	{ value: "block", labelKey: "securityPolicy.forwardingBlock" },
];

const passwordRules: Array<{ key: "requireLetters" | "requireNumbers" | "requireSymbols"; labelKey: TranslationKey }> = [
	{ key: "requireLetters", labelKey: "securityPolicy.requireLetters" },
	{ key: "requireNumbers", labelKey: "securityPolicy.requireNumbers" },
	{ key: "requireSymbols", labelKey: "securityPolicy.requireSymbols" },
];

function RadioRow({ name, checked, disabled, onSelect, label }: { name: string; checked: boolean; disabled: boolean; onSelect: () => void; label: string }) {
	return <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-800 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
		<input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="h-4 w-4 accent-blue-600" />
		{label}
	</label>;
}

export default function SecurityPolicyPage() {
	const { t } = useLanguage();
	const [data, setData] = useState<SecurityPolicyResponse | null>(null);
	const [form, setForm] = useState<SecurityPolicyForm | null>(null);
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState("");

	useEffect(() => {
		let active = true;
		void loadSecurityPolicy().then((response) => {
			if (!active) return;
			setData(response);
			setForm(toSecurityPolicyForm(response));
		}).catch((error) => { if (active) setStatus(error instanceof Error ? error.message : t("securityPolicy.loadFailed")); });
		return () => { active = false; };
	}, [t]);

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!form) return;
		setSaving(true);
		setStatus("");
		try {
			const response = await saveSecurityPolicy(form);
			setData(response);
			setForm(toSecurityPolicyForm(response));
			setStatus(t("securityPolicy.saved"));
		} catch (error) {
			setStatus(error instanceof Error ? error.message : t("securityPolicy.saveFailed"));
		} finally { setSaving(false); }
	}

	const update = (change: (current: SecurityPolicyForm) => SecurityPolicyForm) => setForm((current) => current ? change(current) : current);
	const disabled = !form || !data?.available || saving;
	const enforcement = form?.twoStep.enforcement ?? "off";
	const compliance = data && enforcement !== "off" ? data.compliance[enforcement] : null;
	const widening = !!data && !!form && widensTwoStep(data.policy.twoStep.enforcement, form.twoStep.enforcement);

	return <form onSubmit={save} className="space-y-6">
		<div>
			<h1 className="text-2xl md:text-3xl font-medium text-neutral-900">{t("securityPolicy.title")}</h1>
			<p className="mt-2 text-sm text-neutral-500">{t("securityPolicy.description")}</p>
		</div>
		{data && !data.available && <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">{t("securityPolicy.unavailable")}</p>}

		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0"><CardTitle>{t("securityPolicy.twoStepTitle")}</CardTitle><p className="text-sm text-neutral-500">{t("securityPolicy.twoStepDescription")}</p></CardHeader>
			<CardContent className="space-y-4 pt-6">
				<fieldset className="grid gap-2 sm:grid-cols-3" aria-label={t("securityPolicy.twoStepTitle")}>
					{twoStepOptions.map((option) => <RadioRow key={option.value} name="two-step" label={t(option.labelKey)} checked={enforcement === option.value} disabled={disabled} onSelect={() => update((current) => ({ ...current, twoStep: { ...current.twoStep, enforcement: option.value } }))} />)}
				</fieldset>
				{enforcement !== "off" && <div className="space-y-2">
					<Label htmlFor="two-step-grace">{t("securityPolicy.graceDays")}</Label>
					<Input id="two-step-grace" type="number" min="0" max="90" step="1" className="max-w-40" required disabled={disabled} value={form?.twoStep.graceDays ?? 7} onChange={(event) => { const graceDays = Number(event.target.value); update((current) => ({ ...current, twoStep: { ...current.twoStep, graceDays } })); }} />
					<p className="text-sm text-neutral-500">{t("securityPolicy.graceHint")}</p>
				</div>}
				{compliance && <div className="space-y-1 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700">
					<p>{t("securityPolicy.compliance", { enrolled: String(compliance.enrolled), affected: String(compliance.affected) })}</p>
					{!widening && compliance.overdue > 0 && <p className="text-amber-800">{t("securityPolicy.complianceOverdue", { count: String(compliance.overdue) })}</p>}
					{widening && <p>{t("securityPolicy.restartsGrace")}</p>}
				</div>}
			</CardContent>
		</Card>

		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0"><CardTitle>{t("securityPolicy.passwordTitle")}</CardTitle><p className="text-sm text-neutral-500">{t("securityPolicy.passwordDescription")}</p></CardHeader>
			<CardContent className="space-y-4 pt-6">
				<div className="space-y-2">
					<Label htmlFor="password-min-length">{t("securityPolicy.minLength")}</Label>
					<Input id="password-min-length" type="number" min="8" max="128" step="1" className="max-w-40" required disabled={disabled} value={form?.password.minLength ?? 8} onChange={(event) => { const minLength = Number(event.target.value); update((current) => ({ ...current, password: { ...current.password, minLength } })); }} />
				</div>
				<div className="space-y-3">
					{passwordRules.map((rule) => <div key={rule.key} className="flex items-center gap-3">
						<Checkbox id={`password-${rule.key}`} checked={form?.password[rule.key] ?? false} disabled={disabled} onChange={(event) => { const checked = event.target.checked; update((current) => ({ ...current, password: { ...current.password, [rule.key]: checked } })); }} />
						<Label htmlFor={`password-${rule.key}`} className="font-normal">{t(rule.labelKey)}</Label>
					</div>)}
				</div>
			</CardContent>
		</Card>

		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0"><CardTitle>{t("securityPolicy.sessionTitle")}</CardTitle><p className="text-sm text-neutral-500">{t("securityPolicy.sessionDescription")}</p></CardHeader>
			<CardContent className="space-y-2 pt-6">
				<Label htmlFor="session-days">{t("securityPolicy.sessionDays")}</Label>
				<Input id="session-days" type="number" min="1" max="365" step="1" className="max-w-40" required disabled={disabled} value={form?.sessionDays ?? 30} onChange={(event) => { const sessionDays = Number(event.target.value); update((current) => ({ ...current, sessionDays })); }} />
				<p className="text-sm text-neutral-500">{t("securityPolicy.sessionHint")}</p>
			</CardContent>
		</Card>

		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0"><CardTitle>{t("securityPolicy.forwardingTitle")}</CardTitle><p className="text-sm text-neutral-500">{t("securityPolicy.forwardingDescription")}</p></CardHeader>
			<CardContent className="space-y-4 pt-6">
				<fieldset className="grid gap-2 sm:grid-cols-2" aria-label={t("securityPolicy.forwardingTitle")}>
					{forwardingOptions.map((option) => <RadioRow key={option.value} name="external-forwarding" label={t(option.labelKey)} checked={form?.externalForwarding === option.value} disabled={disabled} onSelect={() => update((current) => ({ ...current, externalForwarding: option.value }))} />)}
				</fieldset>
				<p className="text-sm text-neutral-500">{t("securityPolicy.forwardingHint")}</p>
			</CardContent>
		</Card>

		<div className="flex flex-wrap items-center gap-4">
			<Button type="submit" disabled={disabled || !form || !isValidSecurityPolicyForm(form)}>{saving ? t("common.saving") : t("securityPolicy.save")}</Button>
			{status && <p role="status" className="text-sm text-neutral-700">{status}</p>}
		</div>
	</form>;
}
