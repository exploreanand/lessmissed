import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import './popup.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScreenshotStatus = 'idle' | 'capturing' | 'done' | 'error';
type ResolveStatus = 'loading' | 'ok' | 'no-project' | 'unauthed';

interface StoredScreenshot {
  ok: boolean;
  url?: string;
  error?: string;
  pageSlug: string;
  capturedAt: number;
}

interface ResolvedProject {
  consumer_id: string;
  project_id: string;
  project_name: string;
  domain: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendToActiveTab(message: object): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) { resolve(null); return; }
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(response);
      });
    });
  });
}

const WEBAPP_URL = __API_BASE__;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const App: React.FC = () => {
  const [isTracking, setIsTracking]           = useState(false);
  const [isCalibrating, setIsCalibrating]     = useState(false);
  const [isDotVisible, setIsDotVisible]       = useState(true);
  const [ssStatus, setSsStatus]               = useState<ScreenshotStatus>('idle');
  const [ssUrl, setSsUrl]                     = useState<string | null>(null);
  const [ssError, setSsError]                 = useState<string | null>(null);
  const [currentTab, setCurrentTab]           = useState<chrome.tabs.Tab | null>(null);

  // Project resolution state
  const [resolveStatus, setResolveStatus]     = useState<ResolveStatus>('loading');
  const [resolved, setResolved]               = useState<ResolvedProject | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // ---- On mount ----
  useEffect(() => {
    // Sync tracking state from content script
    sendToActiveTab({ action: 'STATUS' }).then((res) => {
      if (res) {
        setIsTracking(res.status === 'started');
        setIsDotVisible(res.dotVisible ?? true);
        if (res.session_id) setActiveSessionId(res.session_id);
      }
    });

    // Get current tab then resolve project
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0] ?? null;
      setCurrentTab(tab);

      if (!tab?.url) { setResolveStatus('no-project'); return; }

      let domain = '';
      try { domain = new URL(tab.url).hostname; } catch { setResolveStatus('no-project'); return; }

      fetch(`${WEBAPP_URL}/api/extension/resolve?domain=${encodeURIComponent(domain)}`, {
        credentials: 'include',
      })
        .then((r) => {
          if (r.status === 401) { setResolveStatus('unauthed'); return null; }
          if (r.status === 404) { setResolveStatus('no-project'); return null; }
          if (!r.ok) { setResolveStatus('no-project'); return null; }
          return r.json();
        })
        .then((d: ResolvedProject | null) => {
          if (!d) return;
          setResolved(d);
          setResolveStatus('ok');
          chrome.storage.local.set({ resolvedProjectId: d.project_id, resolvedConsumerId: d.consumer_id });
        })
        .catch(() => setResolveStatus('no-project'));
    });

    // Poll chrome.storage for screenshot completion (background writes here)
    const interval = setInterval(() => {
      chrome.storage.local.get('lastScreenshot', (data: { lastScreenshot?: StoredScreenshot }) => {
        const ss = data.lastScreenshot;
        if (!ss || Date.now() - ss.capturedAt > 60000) return;
        if (ss.ok && ss.url) {
          setSsStatus('done');
          setSsUrl(ss.url);
        } else if (!ss.ok) {
          setSsStatus('error');
          setSsError(ss.error ?? null);
        }
      });
    }, 800);

    return () => clearInterval(interval);
  }, []);

  // ---- Tracking toggle ----
  const toggleTracking = useCallback(async () => {
    if (isTracking) {
      // Stop content script first — response includes the session_id
      const res = await sendToActiveTab({ action: 'STOP' });
      const sid = res?.session_id ?? activeSessionId;
      setIsTracking(false);
      setActiveSessionId(null);
      chrome.storage.local.remove('activeSessionId');

      // Finalize session via background
      if (sid) {
        chrome.runtime.sendMessage({
          action: 'SESSION_END',
          session_id: sid,
          ended_at: new Date().toISOString(),
        });
      }
    } else {
      if (!resolved) return; // resolve not ready

      let pageUrl = '/';
      try { pageUrl = new URL(currentTab?.url ?? '/').pathname; } catch {}

      // Create session via background → background forwards START with session_id to content script
      chrome.runtime.sendMessage(
        {
          action: 'SESSION_START',
          project_id: resolved.project_id,
          consumer_id: resolved.consumer_id,
          page_url: pageUrl,
        },
        (res) => {
          if (chrome.runtime.lastError) return;
          if (res?.error === 'content_script_not_ready') {
            setSsStatus('error');
            setSsError('Reload the page (F5), then retry.');
            return;
          }
          if (res?.ok) {
            setIsTracking(true);
            setActiveSessionId(res.session_id);
            chrome.storage.local.set({ activeSessionId: res.session_id });
          }
        }
      );
    }
  }, [isTracking, resolved, activeSessionId, currentTab]);

  // ---- Calibration ----
  const calibrate = useCallback(() => {
    setIsCalibrating(true);
    sendToActiveTab({ action: 'CALIBRATE' }).then((res) => {
      if (res?.status === 'calibrated') setIsCalibrating(false);
    });
  }, []);

  // ---- Dot toggle ----
  const toggleDot = useCallback(async () => {
    const res = await sendToActiveTab({ action: 'TOGGLE_DOT' });
    if (res) setIsDotVisible(res.dotVisible);
  }, []);

  // ---- Screenshot ----
  const takeScreenshot = useCallback(async () => {
    if (ssStatus === 'capturing') return;

    // Resolve project_id — prefer in-memory, fall back to storage
    let pid = resolved?.project_id ?? null;
    if (!pid) {
      pid = await new Promise<string | null>((r) =>
        chrome.storage.local.get('resolvedProjectId', (d) => r((d as any).resolvedProjectId ?? null))
      );
    }
    if (!pid) { setSsStatus('error'); return; }

    setSsStatus('capturing');
    setSsUrl(null);
    setSsError(null);

    let pageUrl = '/';
    let pageSlug = 'home';
    if (currentTab?.url) {
      try {
        const u = new URL(currentTab.url);
        pageUrl = u.pathname;
        pageSlug = u.pathname.replace(/^\//, '').replace(/\//g, '-') || 'home';
      } catch {}
    }

    chrome.storage.local.remove('lastScreenshot');

    chrome.runtime.sendMessage(
      { action: 'TAKE_SCREENSHOT', projectId: pid, pageUrl, pageSlug },
      (res) => {
        if (!res?.ok) setSsStatus('error');
      }
    );
  }, [ssStatus, currentTab, resolved]);

  // ---- Derived display ----
  const domain = currentTab?.url
    ? (() => { try { return new URL(currentTab.url).hostname; } catch { return '—'; } })()
    : '—';

  const ssLabel =
    ssStatus === 'capturing' ? 'Capturing…' :
    ssStatus === 'done'      ? 'Captured ✓' :
    ssStatus === 'error'     ? 'Retry capture' :
                               'Capture page';

  const canTrack = resolveStatus === 'ok';

  return (
    <div className="container">
      <div className="header">
        <span className="logo">👁 LessMissed</span>
        <span className="domain" title={domain}>{domain}</span>
      </div>

      {/* Connection status banner */}
      <div className={`resolve-status resolve-status--${resolveStatus}`}>
        {resolveStatus === 'loading'    && 'Connecting…'}
        {resolveStatus === 'ok'         && `✓ ${resolved?.project_name}`}
        {resolveStatus === 'no-project' && 'No project for this site'}
        {resolveStatus === 'unauthed'   && (
          <a href={`${WEBAPP_URL}/login`} target="_blank" rel="noreferrer">
            Log in to dashboard →
          </a>
        )}
      </div>

      <button
        className={isTracking ? 'btn stop' : 'btn start'}
        onClick={toggleTracking}
        disabled={!canTrack}
      >
        {isTracking ? 'Stop Tracking' : 'Start Tracking'}
      </button>

      <button className="btn calibrate" onClick={calibrate} disabled={isCalibrating}>
        {isCalibrating ? 'Calibrating…' : 'Calibrate'}
      </button>

      <button className={isDotVisible ? 'btn dot-on' : 'btn dot-off'} onClick={toggleDot} disabled={!isTracking}>
        {isDotVisible ? 'Hide Gaze Dot' : 'Show Gaze Dot'}
      </button>

      <hr className="divider" />

      <p className="section-label">Heatmap snapshot</p>

      <button
        className={`btn screenshot${ssStatus === 'done' ? ' done' : ssStatus === 'error' ? ' error' : ''}`}
        onClick={takeScreenshot}
        disabled={ssStatus === 'capturing' || !canTrack}
      >
        {ssLabel}
      </button>

      {ssStatus === 'capturing' && <p className="ss-note">Scrolling &amp; stitching full page…</p>}
      {ssStatus === 'done' && ssUrl && (
        <p className="ss-note">
          Saved ·{' '}
          <a href={`${WEBAPP_URL}/dashboard`} target="_blank" rel="noreferrer">
            View in dashboard →
          </a>
        </p>
      )}
      {ssStatus === 'error' && (
        <p className="ss-note error">
          {ssError?.includes('content script not ready')
            ? 'Reload the page (F5), then retry.'
            : ssError
            ? `Error: ${ssError}`
            : 'Capture failed. Check the DevTools console.'}
        </p>
      )}
    </div>
  );
};

const root = document.createElement('div');
document.body.appendChild(root);
ReactDOM.render(<App />, root);
