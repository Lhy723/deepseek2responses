import type { Lang } from "../i18n";
import { text } from "../i18n";
import type { CacheStats, Summary } from "../types";

interface Props {
  cache: CacheStats | null;
  summary: Summary | null;
  lang: Lang;
}

export function CachePanel({ cache, summary, lang }: Props) {
  const t = text[lang];
  return (
    <section className="mini-panel cache-panel">
      <div className="mini-panel-head">
        <h2>{t.cacheTitle}</h2>
        <p>{t.cacheDesc}</p>
      </div>
      <div className="cache-bars">
        <CacheBar label={t.deepseek} value={summary?.providerPromptCacheHitRate} hint={`${summary?.totalPromptCacheHitTokens ?? 0} hit / ${summary?.totalPromptCacheMissTokens ?? 0} miss`} />
        <CacheBar label={t.responses} value={cache?.hitRate ?? 0} hint={`${cache?.hitCount ?? 0} hit / ${cache?.missCount ?? 0} miss`} />
      </div>
    </section>
  );
}

function CacheBar({ label, value, hint }: { label: string; value: number | null | undefined; hint: string }) {
  const percent = value == null ? 0 : Math.max(0, Math.min(100, value * 100));
  return (
    <div className="cache-row">
      <div className="cache-title">
        <span>{label}</span>
        <strong>{value == null ? "—" : `${percent.toFixed(1)}%`}</strong>
      </div>
      <div className="bar"><div style={{ width: `${percent}%` }} /></div>
      <small>{hint}</small>
    </div>
  );
}
