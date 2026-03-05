import { useMemo, useRef, useState, useEffect } from 'react';
import './App.css';
import { invoke } from '@tauri-apps/api/core';
import { Window } from '@tauri-apps/api/window';

type ProbeResponse = {
  status_code: number | null;
  elapsed_ms: number;
  error: string | null;
};

type RequestRow = {
  id: number;
  finishedAt: string;
  statusCode: number | null;
  elapsedMs: number;
  error: string | null;
};

type InFlightRow = {
  id: number;
  startedAtMs: number;
  startedAt: string;
};

const STUCK_THRESHOLD_MS = 10000;

function toPositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function App() {
  const [platform, setPlatform] = useState('');
  const [url, setUrl] = useState('https://example.com');
  const [requestCount, setRequestCount] = useState('20');
  const [concurrency, setConcurrency] = useState('5');
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [inFlightRows, setInFlightRows] = useState<InFlightRow[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(0);
  const [finished, setFinished] = useState(0);
  const [active, setActive] = useState(0);
  const [clockMs, setClockMs] = useState(Date.now());

  const runTokenRef = useRef(0);

  useEffect(() => {
    invoke('get_platform').then((p: unknown) => setPlatform(p as string));
  }, []);

  useEffect(() => {
    if (!running && inFlightRows.length === 0) return;

    const timer = window.setInterval(() => setClockMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running, inFlightRows.length]);

  const appWindow = Window.getCurrent();
  const isWindows = platform === 'windows';
  const toggleShortcut = platform === 'macos' ? 'Shift+Cmd+T' : 'Shift+Ctrl+T';

  const successCount = useMemo(
    () => rows.filter((row) => row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 400).length,
    [rows],
  );

  const averageMs = useMemo(() => {
    if (!rows.length) return 0;
    const total = rows.reduce((acc, row) => acc + row.elapsedMs, 0);
    return total / rows.length;
  }, [rows]);

  const stopRun = () => {
    runTokenRef.current += 1;
    setRunning(false);
    setActive(0);
    setInFlightRows([]);
  };

  const startRun = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || running) return;

    const total = toPositiveInt(requestCount, 1);
    const limit = toPositiveInt(concurrency, 1);

    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;

    setRows([]);
    setInFlightRows([]);
    setStarted(0);
    setFinished(0);
    setActive(0);
    setRunning(true);

    let launched = 0;
    let completed = 0;
    let inFlight = 0;

    await new Promise<void>((resolve) => {
      const maybeFinish = () => {
        if (completed >= total || runTokenRef.current !== runToken) {
          setRunning(false);
          setActive(0);
          setInFlightRows([]);
          resolve();
        }
      };

      const schedule = () => {
        if (runTokenRef.current !== runToken) {
          maybeFinish();
          return;
        }

        while (inFlight < limit && launched < total) {
          const requestId = launched + 1;
          launched += 1;
          inFlight += 1;

          const startedAtMs = Date.now();

          setStarted((value) => value + 1);
          setActive(inFlight);
          setInFlightRows((value) => [{ id: requestId, startedAtMs, startedAt: new Date().toLocaleTimeString() }, ...value]);

          invoke<ProbeResponse>('perform_request', { url: trimmedUrl })
            .catch((error: unknown) => ({
              status_code: null,
              elapsed_ms: 0,
              error: String(error),
            }))
            .then((result) => {
              if (runTokenRef.current !== runToken) {
                return;
              }

              const row: RequestRow = {
                id: requestId,
                finishedAt: new Date().toLocaleTimeString(),
                statusCode: result.status_code,
                elapsedMs: result.elapsed_ms,
                error: result.error,
              };

              inFlight -= 1;
              completed += 1;

              setInFlightRows((value) => value.filter((item) => item.id !== requestId));
              setRows((value) => [row, ...value]);
              setFinished(completed);
              setActive(inFlight);

              if (completed < total) {
                schedule();
              } else {
                maybeFinish();
              }
            });
        }

        maybeFinish();
      };

      schedule();
    });
  };

  return (
    <div className={isWindows ? 'window' : 'macos-window'}>
      {isWindows ? (
        <div
          className="titlebar windows-titlebar"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0 8px',
            height: '32px',
          }}
        >
          <div className="window-title">bewindow</div>
          <div className="windows-controls" style={{ display: 'flex', gap: '4px' }}>
            <button onClick={() => appWindow.minimize()} style={{ minWidth: '32px' }}>
              _
            </button>
            <button onClick={() => appWindow.toggleMaximize()} style={{ minWidth: '32px' }}>
              []
            </button>
            <button onClick={() => appWindow.close()} style={{ minWidth: '32px' }}>
              X
            </button>
          </div>
        </div>
      ) : (
        <div className="titlebar" data-tauri-drag-region>
          <div className="window-title">bewindow</div>
        </div>
      )}

      <div className="window-content nettest-content">
        <h1>Request Load Tester</h1>
        <p>Send repeated requests with a fixed concurrent limit and inspect response status and latency.</p>

        <div className="controls" aria-label="Request controls">
          <label>
            URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://api.example.com/health"
              disabled={running}
            />
          </label>
          <label>
            Total Requests
            <input
              type="number"
              min={1}
              value={requestCount}
              onChange={(event) => setRequestCount(event.target.value)}
              disabled={running}
            />
          </label>
          <label>
            Max Concurrent
            <input
              type="number"
              min={1}
              value={concurrency}
              onChange={(event) => setConcurrency(event.target.value)}
              disabled={running}
            />
          </label>
          <div className="actions">
            <button className="action-button primary" onClick={startRun} disabled={running || !url.trim()}>
              Start
            </button>
            <button className="action-button" onClick={stopRun} disabled={!running}>
              Stop
            </button>
          </div>
        </div>

        <div className="summary" aria-live="polite">
          <span>Started: {started}</span>
          <span>Completed: {finished}</span>
          <span>In Flight: {active}</span>
          <span>Success: {successCount}</span>
          <span>Avg: {averageMs.toFixed(1)} ms</span>
        </div>

        <div className="tables-grid">
          <section className="table-panel">
            <h2>In Flight Requests</h2>
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Started</th>
                    <th>Running</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {inFlightRows.length ? (
                    inFlightRows.map((row) => {
                      const elapsed = clockMs - row.startedAtMs;
                      const isStuck = elapsed >= STUCK_THRESHOLD_MS;

                      return (
                        <tr key={`inflight-${row.id}`}>
                          <td>{row.id}</td>
                          <td>{row.startedAt}</td>
                          <td>{(elapsed / 1000).toFixed(1)} s</td>
                          <td>{isStuck ? 'Possibly stuck' : 'Running'}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} className="empty">
                        No active requests.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="table-panel">
            <h2>Completed Requests</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Finished</th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((row) => (
                      <tr key={`${row.id}-${row.finishedAt}-${row.elapsedMs}`}>
                        <td>{row.id}</td>
                        <td>{row.finishedAt}</td>
                        <td>{row.statusCode ?? '-'}</td>
                        <td>{row.elapsedMs.toFixed(1)} ms</td>
                        <td>{row.error ?? '-'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty">
                        No requests yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <footer className="macos-footer">
        <div className="footer-left">made by bero</div>
        <div className="footer-right">{toggleShortcut} Toggle window</div>
      </footer>
    </div>
  );
}

export default App;
