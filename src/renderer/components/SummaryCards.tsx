import { Activity, Clock, Cpu, Zap } from "lucide-react";
import type { Lang } from "../i18n";
import { text } from "../i18n";
import type { Summary } from "../types";

interface Props {
  summary: Summary | null;
  lang: Lang;
}

export function SummaryCards({ summary, lang }: Props) {
  const t = text[lang].metrics;
  const cards = [
    { label: t.tokens, value: formatNumber(summary?.totalTokens ?? 0), icon: Zap },
    { label: t.cacheable, value: formatNumber(summary?.totalPromptCacheHitTokens ?? 0), icon: Cpu },
    { label: t.requests, value: summary?.totalRequests ?? 0, icon: Activity },
    { label: t.latency, value: `${Math.round(summary?.averageDurationMs ?? 0)}ms`, icon: Clock },
  ];

  return (
    <section className="mini-metrics">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article className="mini-metric" key={card.label}>
            <div className="metric-top"><span>{card.label}</span><Icon size={13} /></div>
            <div className="metric-value">{card.value}</div>
          </article>
        );
      })}
    </section>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: value > 9999 ? "compact" : "standard" }).format(value);
}
