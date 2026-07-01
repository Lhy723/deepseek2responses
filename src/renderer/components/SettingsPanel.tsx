import { useEffect, useState } from "react";
import type { Lang } from "../i18n";
import { text } from "../i18n";
import type { RuntimeInfo, SettingsInput } from "../types";

interface Props {
  runtime: RuntimeInfo | null;
  lang: Lang;
  onSave?: (input: SettingsInput) => Promise<{ restartRequired: boolean }>;
}

export function SettingsPanel({ runtime, lang, onSave }: Props) {
  const t = text[lang];
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(runtime?.baseUrl || "https://api.deepseek.com/v1");
  const [host, setHost] = useState(runtime?.host || "127.0.0.1");
  const [port, setPort] = useState(String(runtime?.port || 19199));
  const [timeout, setTimeoutValue] = useState(String(runtime?.timeout || 300));
  const [statsFile, setStatsFile] = useState(runtime?.statsFile || "");
  const [logFile, setLogFile] = useState(runtime?.logFile || "");
  const [maxOutputTokensCap, setMaxOutputTokensCap] = useState(String(runtime?.maxOutputTokensCap || 393216));
  const [unsupportedTools, setUnsupportedTools] = useState<"error" | "drop">(runtime?.unsupportedTools || "drop");
  const [toolNameSanitize, setToolNameSanitize] = useState(runtime?.toolNameSanitize ?? true);
  const [mappingText, setMappingText] = useState(JSON.stringify(runtime?.modelMapping || {}, null, 2));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBaseUrl(runtime?.baseUrl || "https://api.deepseek.com/v1");
    setHost(runtime?.host || "127.0.0.1");
    setPort(String(runtime?.port || 19199));
    setTimeoutValue(String(runtime?.timeout || 300));
    setStatsFile(runtime?.statsFile || "");
    setLogFile(runtime?.logFile || "");
    setMaxOutputTokensCap(String(runtime?.maxOutputTokensCap || 393216));
    setUnsupportedTools(runtime?.unsupportedTools || "drop");
    setToolNameSanitize(runtime?.toolNameSanitize ?? true);
    setMappingText(JSON.stringify(runtime?.modelMapping || {}, null, 2));
  }, [runtime]);

  async function save() {
    if (!onSave) return;
    setSaving(true);
    setMessage(null);
    try {
      const modelMapping = mappingText.trim() ? JSON.parse(mappingText) : {};
      const result = await onSave({
        apiKey: apiKey.trim() || undefined,
        baseUrl,
        host,
        port: Number(port),
        timeout: Number(timeout),
        statsFile,
        logFile,
        modelMapping,
        maxOutputTokensCap: Number(maxOutputTokensCap),
        unsupportedTools,
        toolNameSanitize,
      });
      setApiKey("");
      setMessage(result.restartRequired ? t.savedRestart : t.saved);
    } catch (err: any) {
      setMessage(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mini-stack settings-mini">
      <section className="mini-panel">
        <div className="mini-panel-head">
          <h2>{t.settingsTitle}</h2>
          <p>{t.settingsDesc}</p>
        </div>
        <div className="form-stack">
          <Field label={t.replaceApiKey}>
            <input type="password" placeholder={runtime?.apiKey || "sk-..."} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
          <Field label={t.baseUrl}>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
          <div className="field-row">
            <Field label={t.host}><input value={host} onChange={(e) => setHost(e.target.value)} /></Field>
            <Field label={t.port}><input inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} /></Field>
          </div>
          <Field label={t.timeout}>
            <input inputMode="numeric" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} />
          </Field>
          <Field label={t.statsJsonl}>
            <input value={statsFile} onChange={(e) => setStatsFile(e.target.value)} />
          </Field>
          <Field label={t.appLog}>
            <input value={logFile} onChange={(e) => setLogFile(e.target.value)} />
          </Field>
          <div className="field-row">
            <Field label={t.maxTokensCap}><input inputMode="numeric" value={maxOutputTokensCap} onChange={(e) => setMaxOutputTokensCap(e.target.value)} /></Field>
            <Field label={t.unsupportedTools}>
              <select value={unsupportedTools} onChange={(e) => setUnsupportedTools(e.target.value as "error" | "drop")}>
                <option value="error">error</option>
                <option value="drop">drop</option>
              </select>
            </Field>
          </div>
          <label className="check-field">
            <input type="checkbox" checked={toolNameSanitize} onChange={(e) => setToolNameSanitize(e.target.checked)} />
            <span>{t.sanitizeTools}</span>
          </label>
          <Field label={t.modelMapping}>
            <textarea rows={4} value={mappingText} onChange={(e) => setMappingText(e.target.value)} />
          </Field>
          <button className="primary-button" onClick={() => void save()} disabled={saving || !onSave}>{saving ? t.saving : t.save}</button>
          {message && <div className="setup-note">{message}</div>}
        </div>
      </section>

      <section className="mini-panel compact-info">
        <Info label={t.endpoint} value={runtime ? `http://127.0.0.1:${runtime.port}/v1/responses` : "—"} />
        <Info label={t.appLog} value={runtime?.logFile || "—"} />
        <Info label={t.auth} value={runtime?.noAuth ? "disabled" : runtime?.configAuth ? "enabled" : "empty"} />
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
