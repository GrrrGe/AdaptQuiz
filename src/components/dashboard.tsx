"use client";

import type { DashboardRes } from "@/lib/client";
import { CARD } from "@/components/quiz";

function Bar({ value, mastered }: { value: number; mastered: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full transition-all ${mastered ? "bg-emerald-500" : "bg-[#2C80FF]"}`}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

/** Dashboard: per-concept bars + overall % + history. */
export function Dashboard({ data }: { data: DashboardRes }) {
  const p = data.progress;
  return (
    <div className="space-y-4">
      <div className={`${CARD} p-5`}>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-[#3D5A80]">{data.session.title}</h2>
          <span className="text-3xl font-bold text-[#2C80FF]">{Math.round(p.percent)}%</span>
        </div>
        <p className="mb-2 text-sm text-[#94A3B8]">
          {p.mastered}/{p.total} mastered
        </p>
        <Bar value={p.percent / 100} mastered={p.percent === 100} />
      </div>

      <ul className="space-y-3">
        {data.concepts.map((c) => (
          <li key={c.id} className={`${CARD} p-4`}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium text-[#3D5A80]">{c.name}</span>
              <span className="shrink-0 text-sm">
                {c.mastered ? (
                  <span className="font-semibold text-emerald-500">mastered ✓</span>
                ) : (
                  <span className="text-[#94A3B8]">{Math.round(c.masteryScore * 100)}%</span>
                )}
              </span>
            </div>
            <Bar value={c.masteryScore} mastered={c.mastered} />
            <p className="mt-1 text-xs text-[#94A3B8]">
              {c.attempts} attempts · streak {c.correctStreak}
              {c.sourceExcerpt ? ` · “${c.sourceExcerpt.slice(0, 90)}…”` : ""}
            </p>
          </li>
        ))}
      </ul>

      {data.recentAttempts.length > 0 && (
        <div className={`${CARD} p-4`}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#94A3B8]">
            Recent
          </h3>
          <ul className="space-y-1 text-sm">
            {data.recentAttempts.slice(0, 10).map((a) => (
              <li key={a.id} className="flex justify-between gap-2 text-[#3D5A80]">
                <span className="truncate">
                  {a.concept_name} · {a.question_type}
                </span>
                <span className={a.score >= 0.8 ? "font-semibold text-emerald-500" : "font-semibold text-amber-500"}>
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
