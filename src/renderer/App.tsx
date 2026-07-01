import { Play, RefreshCw, Settings, Square, TestTube2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CachePanel } from "./components/CachePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SummaryCards } from "./components/SummaryCards";
import { TokenChart } from "./components/TokenChart";
import type { Lang } from "./i18n";
import { text } from "./i18n";
import type { CacheStats, DesktopState, RuntimeInfo, Summary, TokenBucket } from "./types";

type Page = "setup" | "tokens" | "settings";

const fallbackBridge = window.deepseek2responses;

export function App() {
  const [page, setPage] = useState<Page>("setup");
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("d2r-lang") as Lang) || "zh");
  const [state, setState] = useState<DesktopState | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [tokens, setTokens] = useState<TokenBucket[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [starting, setStarting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bridgeMissing = !fallbackBridge;
  const t = text[lang];
  const endpoint = useMemo(() => runtime ? `127.0.0.1:${runtime.port}` : "not running", [runtime]);
  const fullEndpoint = useMemo(() => runtime ? `http://127.0.0.1:${runtime.port}` : "", [runtime]);
  const baseUrlV1 = useMemo(() => runtime ? `http://127.0.0.1:${runtime.port}/v1` : "", [runtime]);

  function toggleLang() {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next);
    localStorage.setItem("d2r-lang", next);
  }

  const refreshStats = useCallback(async () => {
    if (!fallbackBridge) return;
    setLoading(true);
    try {
      const snapshot = await fallbackBridge.getStats();
      setSummary(snapshot.summary);
      setCache(snapshot.cache);
      setRuntime(snapshot.runtime);
      setTokens(snapshot.tokens);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fallbackBridge) return;
    fallbackBridge.getState().then((next) => {
      setState(next);
      setRuntime(next.runtime);
      setPage("setup");
      if (next.serverRunning) void refreshStats();
    }).catch((err) => setError(err?.message || String(err)));
  }, [refreshStats]);

  useEffect(() => {
    if (page !== "tokens" || !state?.serverRunning) return;
    void refreshStats();
    const timer = window.setInterval(() => void refreshStats(), 5000);
    return () => window.clearInterval(timer);
  }, [page, state?.serverRunning, refreshStats]);

  async function start() {
    if (!fallbackBridge) return;
    setError(null);
    setStarting(true);
    try {
      const next = await fallbackBridge.start({ apiKey });
      setState(next);
      setRuntime(next.runtime);
      setPage("tokens");
      setApiKey("");
      await refreshStats();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    if (!fallbackBridge) return;
    setError(null);
    try {
      const next = await fallbackBridge.stop();
      setState(next);
      setRuntime(next.runtime);
      setSummary(null);
      setCache(null);
      setTokens([]);
      setTestMessage(null);
      setPage("setup");
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }

  async function testProxy() {
    if (!fallbackBridge) return;
    setError(null);
    setTestMessage(null);
    setTesting(true);
    try {
      const result = await fallbackBridge.test();
      setTestMessage(`${t.testPassed} · ${result.model} · ${result.durationMs}ms`);
      await refreshStats();
    } catch (err: any) {
      setTestMessage(null);
      setError(`${t.testFailed} · ${err?.message || String(err)}`);
    } finally {
      setTesting(false);
    }
  }

  async function copyEndpoint() {
    if (!baseUrlV1) return;
    await navigator.clipboard?.writeText(baseUrlV1);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function copyApiKey() {
    if (!fallbackBridge) return;
    const key = await fallbackBridge.getApiKey();
    await navigator.clipboard?.writeText(key);
    setApiKeyCopied(true);
    window.setTimeout(() => setApiKeyCopied(false), 1200);
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-row">
            <div className="brand-dot">d</div>
            <div>
              <div className="mini-brand">d2r</div>
              <div className="mini-subtitle">{state?.serverRunning ? endpoint : t.setupRequired}</div>
            </div>
          </div>
          <div className="status-pill"><span className={state?.serverRunning ? "status-dot running" : "status-dot"} />{state?.serverRunning ? "running" : "stopped"}</div>
        </div>

        <nav className="sidebar-nav">
          <button className={page === "tokens" ? "active" : ""} disabled={!state?.serverRunning} onClick={() => setPage("tokens")}>{t.usage}</button>
          <button className={page === "settings" ? "active" : ""} disabled={!state?.serverRunning} onClick={() => setPage("settings")}><Settings size={13} /> {t.settings}</button>
        </nav>

        <div className="sidebar-footer">
          <button className="text-button lang-button" onClick={toggleLang}>{lang === "zh" ? "EN" : "中"}</button>
          {state?.serverRunning ? (
            <button className="sidebar-action stop-button" onClick={() => void stop()}><Square size={11} /> Stop</button>
          ) : (
            <button className="sidebar-action" onClick={() => void start()} disabled={(!apiKey.trim() && !state?.hasApiKey) || starting || bridgeMissing}><Play size={12} /> {starting ? t.starting : t.start}</button>
          )}
        </div>
      </aside>

      <main className="content">
        <header className="content-header">
          <div>
            <h1>{page === "settings" ? t.settingsTitle : page === "tokens" ? t.chartTitle : t.startTitle}</h1>
            <p>{page === "settings" ? t.settingsDesc : page === "tokens" ? endpoint : (state?.hasApiKey ? t.startDescSaved : t.startDescEmpty)}</p>
          </div>
          {state?.serverRunning && page === "tokens" && (
            <div className="title-actions">
              <button className="icon-button" onClick={() => void refreshStats()} disabled={loading} title="Refresh"><RefreshCw size={13} className={loading ? "spin" : ""} /></button>
              <button className="text-button" onClick={() => void testProxy()} disabled={testing} title="Test proxy"><TestTube2 size={12} /> {testing ? t.testing : t.test}</button>
            </div>
          )}
        </header>

        {error && <div className="error-banner mini-error">{error}</div>}
        {testMessage && <div className="success-banner">{testMessage}</div>}
        {bridgeMissing && <div className="error-banner mini-error">{t.preloadMissing}</div>}

        {page === "setup" && (
          <section className="setup-panel">
            <div className="setup-mark"><Zap size={17} /></div>
            <label className="field">
              <span>{t.apiKey}</span>
              <input
                type="password"
                value={apiKey}
                placeholder={state?.hasApiKey ? runtime?.apiKey || "saved key" : "sk-..."}
                onChange={(event) => setApiKey(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void start(); }}
              />
            </label>
            <button className="primary-button" onClick={() => void start()} disabled={(!apiKey.trim() && !state?.hasApiKey) || starting || bridgeMissing}>
              <Play size={14} /> {starting ? t.starting : t.start}
            </button>
            <div className="setup-note">{t.savedTo} {state?.configPath || "~/.deepseek2responses/config.yaml"}</div>
          </section>
        )}

        {page === "tokens" && (
          <>
            <section className="endpoint-card">
              <div>
                <dt>{t.endpoint}</dt>
                <dd>{baseUrlV1}</dd>
              </div>
              <div className="endpoint-actions">
                <button className="text-button" onClick={() => void copyEndpoint()}>{copied ? t.copied : t.copy}</button>
                <button className="text-button" onClick={() => void copyApiKey()}>{apiKeyCopied ? t.copied : t.copyApiKey}</button>
              </div>
            </section>
            <section className="content-grid">
              <SummaryCards summary={summary} lang={lang} />
              <div className="usage-detail">
                <TokenChart data={tokens} lang={lang} />
                <CachePanel cache={cache} summary={summary} lang={lang} />
              </div>
            </section>
          </>
        )}

        {page === "settings" && fallbackBridge && (
          <SettingsPanel
            runtime={runtime}
            lang={lang}
            onSave={async (input) => {
              const next = await fallbackBridge.saveSettings(input);
              setState(next);
              setRuntime(next.runtime);
              return next;
            }}
          />
        )}
      </main>
    </div>
  );
}
