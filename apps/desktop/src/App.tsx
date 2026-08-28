import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";

interface RuntimeConnection {
  handle: string;
  host: "127.0.0.1";
  port: number;
  pid: number;
}

type RuntimeState =
  | { status: "starting" }
  | { status: "ready"; connection: RuntimeConnection }
  | { status: "unavailable"; reason: string };

const checks = [
  { label: "Host repository", value: "Read-only until patch approval", tone: "safe" },
  { label: "Container network", value: "Sealed · offline profile", tone: "safe" },
  { label: "Credential route", value: "Host runtime only", tone: "safe" },
  { label: "Writer lease", value: "Single writer / workspace", tone: "neutral" },
] as const;

export function App() {
  const [runtime, setRuntime] = useState<RuntimeState>({ status: "starting" });
  const runtimeReady = runtime.status === "ready";
  const statusLabel = useMemo(() => {
    if (runtime.status === "ready")
      return `RUNTIME ${runtime.connection.pid} · PORT ${runtime.connection.port}`;
    if (runtime.status === "unavailable") return "RUNTIME UNAVAILABLE";
    return "RUNTIME STARTING";
  }, [runtime]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const connect = async () => {
      if (!("__TAURI_INTERNALS__" in window)) {
        setRuntime({
          status: "unavailable",
          reason: "Web preview only. The protected runtime bridge starts inside the desktop app.",
        });
        return;
      }
      try {
        unlisten = await listen<RuntimeConnection>("noneedwork://runtime-ready", (event) => {
          if (active) setRuntime({ status: "ready", connection: event.payload });
        });
        const current = await invoke<RuntimeConnection | null>("runtime_connection");
        if (active && current) setRuntime({ status: "ready", connection: current });
      } catch (error) {
        if (active) {
          const reason = error instanceof Error ? error.message : "Desktop bridge is not available";
          setRuntime({ status: "unavailable", reason });
        }
      }
    };
    void connect();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return (
    <main className="workbench-shell">
      <header className="topbar">
        <div className="wordmark">
          <span className="wordmark-mark">NW</span>
          <span>NoNeedWork</span>
        </div>
        <div className={`runtime-pill runtime-pill--${runtime.status}`}>
          <span className="status-light" aria-hidden="true" />
          {statusLabel}
        </div>
        <div className="build-label">LOCAL EXECUTION / V0.1</div>
      </header>

      <aside className="task-rail" aria-label="Task ledger">
        <div className="rail-heading">
          <span>Task ledger</span>
          <span className="counter">00</span>
        </div>
        <button className="new-task" type="button" disabled={!runtimeReady}>
          <span>+</span> New task
        </button>
        <div className="empty-ledger">
          <span className="ledger-rule" />
          <p>No active runs.</p>
          <small>Approved work will leave a durable trace here.</small>
        </div>
        <div className="rail-footer">
          <span>LEDGER</span>
          <strong>LOCAL</strong>
        </div>
      </aside>

      <section className="stage">
        <div className="stage-index">01 / PREFLIGHT</div>
        <div className="hero-copy">
          <p className="eyebrow">SOFTWARE-ENGINEERING AGENT</p>
          <h1>
            Work happens
            <br />
            behind a sealed line.
          </h1>
          <p className="lede">
            Select a Git repository. NoNeedWork copies it into an isolated workspace, plans the
            change, verifies the result, then asks before touching the host.
          </p>
        </div>

        <div className="repo-panel">
          <div>
            <span className="field-label">REPOSITORY</span>
            <strong>No repository selected</strong>
          </div>
          <button type="button" disabled={!runtimeReady}>
            Choose folder
          </button>
        </div>

        <div className="gate-row">
          <div className="gate-number">GATE 0</div>
          <div>
            <strong>
              {runtimeReady ? "Runtime link established" : "Waiting for local runtime"}
            </strong>
            <p>
              {runtime.status === "unavailable"
                ? runtime.reason
                : "Docker, Git state, model access, and policy will be checked before a run starts."}
            </p>
          </div>
          <span className={`gate-state ${runtimeReady ? "gate-state--ready" : ""}`}>
            {runtimeReady ? "READY" : "LOCKED"}
          </span>
        </div>
      </section>

      <aside className="safety-panel" aria-label="Safety envelope">
        <div className="safety-heading">
          <span className="crosshair" aria-hidden="true">
            ＋
          </span>
          <div>
            <p>SAFETY ENVELOPE</p>
            <h2>Boundaries before autonomy.</h2>
          </div>
        </div>
        <div className="check-stack">
          {checks.map((check, index) => (
            <article className="check-item" key={check.label}>
              <span className={`check-dot check-dot--${check.tone}`} aria-hidden="true" />
              <div>
                <small>
                  {String(index + 1).padStart(2, "0")} · {check.label}
                </small>
                <p>{check.value}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="approval-block">
          <span>APPROVAL RULE</span>
          <p>A patch hash changes, its approval expires.</p>
        </div>
        <footer>
          <span>NO CLOUD CONTROL PLANE</span>
          <span>↗ TRACEABLE BY DEFAULT</span>
        </footer>
      </aside>
    </main>
  );
}
