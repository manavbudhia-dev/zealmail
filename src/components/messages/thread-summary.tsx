"use client";

import { useState } from "react";
import { LoaderCircle, Sparkles, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { authFetch } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

type SummaryState =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "done"; points: string[] }
	| { kind: "error"; message: string | null };

/**
 * On-demand AI summary of the open conversation. Nothing is generated until the
 * reader asks, and the result lives only in this component: remount it (key it
 * by message id) to start over for another conversation.
 */
export function ThreadSummary({ messageId, className }: { messageId: string; className?: string }) {
	const { t } = useLanguage();
	const [state, setState] = useState<SummaryState>({ kind: "idle" });

	async function summarize() {
		setState({ kind: "loading" });
		try {
			const response = await authFetch(`/api/messages/${encodeURIComponent(messageId)}/summary`, { method: "POST" });
			const data = await response.json().catch(() => null) as { points?: string[]; error?: string } | null;
			if (!response.ok || !data?.points?.length) {
				setState({ kind: "error", message: response.status === 429 ? t("summary.rateLimited") : data?.error ?? null });
				return;
			}
			setState({ kind: "done", points: data.points });
		} catch {
			setState({ kind: "error", message: null });
		}
	}

	if (state.kind === "done") {
		return (
			<section aria-label={t("summary.title")} className={cn("mb-3", className)}>
				<div className="rounded-xl border border-violet-200/80 bg-violet-50/60 px-4 py-3 text-sm text-neutral-800">
					<div className="mb-1.5 flex items-center gap-2">
						<Sparkles className="h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
						<h2 className="flex-1 text-[13px] font-semibold text-violet-900">{t("summary.title")}</h2>
						<button
							type="button"
							onClick={() => setState({ kind: "idle" })}
							aria-label={t("summary.hide")}
							className="rounded-md p-1 text-violet-700 hover:bg-violet-100 focus-visible:outline-2 focus-visible:outline-violet-600"
						>
							<X className="h-4 w-4" aria-hidden="true" />
						</button>
					</div>
					<ul className="list-disc space-y-1 pl-5">
						{state.points.map((point, index) => <li key={index}>{point}</li>)}
					</ul>
					<p className="mt-2 text-xs text-neutral-500">{t("summary.disclaimer")}</p>
				</div>
			</section>
		);
	}

	return (
		<div className={cn("mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", className)}>
			<button
				type="button"
				onClick={() => void summarize()}
				disabled={state.kind === "loading"}
				className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 font-medium text-neutral-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-900 disabled:cursor-wait disabled:opacity-70"
			>
				{state.kind === "loading"
					? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					: <Sparkles className="h-3.5 w-3.5 text-violet-600" aria-hidden="true" />}
				{state.kind === "loading" ? t("summary.loading") : t("summary.button")}
			</button>
			{state.kind === "error" && (
				<span role="alert" className="text-red-700">{state.message ?? t("summary.failed")}</span>
			)}
		</div>
	);
}
