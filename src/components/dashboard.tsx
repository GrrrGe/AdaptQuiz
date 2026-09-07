"use client";

import type { DashboardRes } from "@/lib/client";

function Bar({ value, mastered }: { value: number; mastered: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
      <div
        className={`h-full rounded transition-all ${mastered ? "bg-emerald-500" : "bg-sky-500"}`}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

/** Dashboard: per-concept mastery bars + overall % + recent history. */
export function Dashboard({ data }: { data: DashboardRes }) {
  const p = data.progress;
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{data.session.title}</h2>
          <span className="text-2xl font-bold text-emerald-400">{Math.round(p.percent)}%</span>
        </div>
        <p className="mb-2 text-sm text-zinc-400">
          {p.mastered}/{p.total} mastered
        </p>
        <Bar value={p.percent / 100} mastered={p.percent === 100} />
      </div>

      <ul className="space-y-3">
        {data.concepts.map((c) => (
          <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">{c.name}</span>
              <span className="shrink-0 text-sm">
                {c.mastered ? (
                  <span className="text-emerald-400">mastered ✓</span>
                ) : (
                  <span className="text-zinc-400">{Math.round(c.masteryScore * 100)}%</span>
                )}
              </span>
            </div>
            <Bar value={c.masteryScore} mastered={c.mastered} />
            <p className="mt-1 text-xs text-zinc-500">
              {c.attempts} attempts · streak {c.correctStreak}
              {c.sourceExcerpt ? ` · “${c.sourceExcerpt.slice(0, 90)}…”` : ""}
            </p>
          </li>
        ))}
      </ul>

      {data.recentAttempts.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Recent
          </h3>
          <ul className="space-y-1 text-sm">
            {data.recentAttempts.slice(0, 10).map((a) => (
              <li key={a.id} className="flex justify-between gap-2 text-zinc-300">
                <span className="truncate">
                  {a.concept_name} · {a.question_type}
                </span>
                <span className={a.score >= 0.8 ? "text-emerald-400" : "text-amber-400"}>
                  {Math.round(a.score * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
