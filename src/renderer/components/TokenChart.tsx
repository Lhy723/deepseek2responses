import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Lang } from "../i18n";
import { text } from "../i18n";
import type { TokenBucket } from "../types";

interface Props {
  data: TokenBucket[];
  lang: Lang;
}

export function TokenChart({ data, lang }: Props) {
  const t = text[lang];
  const chartData = data.map((item) => ({
    ...item,
    time: new Date(item.bucket).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
  }));

  return (
    <section className="mini-panel chart-panel">
      <div className="mini-panel-head">
        <div>
          <h2>{t.chartTitle}</h2>
          <p>{t.chartDesc}</p>
        </div>
      </div>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
            <defs>
              <linearGradient id="input" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#000000" stopOpacity={0.12} />
                <stop offset="95%" stopColor="#000000" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="output" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#737373" stopOpacity={0.12} />
                <stop offset="95%" stopColor="#737373" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eeeeee" vertical={false} />
            <XAxis dataKey="time" stroke="#8a8a8a" tickLine={false} axisLine={false} />
            <YAxis stroke="#8a8a8a" tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e5e5e5", borderRadius: 6, color: "#000000", boxShadow: "0 12px 30px rgba(0,0,0,.08)" }} />
            <Area type="monotone" dataKey="inputTokens" name="Input" stroke="#000000" strokeWidth={1.5} fill="url(#input)" />
            <Area type="monotone" dataKey="outputTokens" name="Output" stroke="#737373" strokeWidth={1.5} fill="url(#output)" />
            <Area type="monotone" dataKey="reasoningTokens" name="Reasoning" stroke="#a3a3a3" strokeWidth={1.5} fillOpacity={0.05} fill="#a3a3a3" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
