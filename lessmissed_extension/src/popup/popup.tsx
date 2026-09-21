import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import './popup.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResolveStatus = 'loading' | 'ok' | 'no-project' | 'unauthed';

interface ResolvedProject {
  consumer_id: string;
  project_id: string;
  project_name: string;
  domain: string;
}

/** What the background worker reports about the running session. It is the
 *  authority now — the content script only knows about the page it is on, so
 *  asking it would read "stopped" on any page the session has not reached. */
interface SessionState {
  active: boolean;
  session_id?: string;
  paused?: boolean;
  current_path?: string;
  pages_visited?: number;
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

function sendToBackground(message: object): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(chrome.runtime.lastError ? null : response);
    });
  });
}

const WEBAPP_URL = __API_BASE__;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const App: React.FC = () => {
  const [session, setSession]                 = useState<SessionState>({ active: false });
  const [isCalibrating, setIsCalibrating]     = useState(false);
  const [isDotVisible, setIsDotVisible]       = useState(true);
  const [currentTab, setCurrentTab]           = useState<chrome.tabs.Tab | null>(null);
  // Why a start attempt failed. Used to borrow the screenshot error slot, which
  // went away with the capture UI — but the failure itself is still real.
  const [startError, setStartError]           = useState<string | null>(null);

  // Project resolution state
  const [resolveStatus, setResolveStatus]     = useState<ResolveStatus>('loading');
  const [resolved, setResolved]               = useState<ResolvedProject | null>(null);

  const isTracking = session.active;

  // ---- On mount ----
  useEffect(() => {
    // The gaze dot lives in the page, so that one flag still comes from the
    // content script — everything else about the session comes from background.
    sendToActiveTab({ action: 'STATUS' }).then((res) => {
      if (res) setIsDotVisible(res.dotVisible ?? true);
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

    // Poll the worker for session state while the popup is open.
    // The session advances a page every few seconds while the popup is open.
    const poll = () => {
      sendToBackground({ action: 'SESSION_STATUS' }).then((res) => {
        if (res) setSession(res);
      });
    };

    poll();
    const interval = setInterval(poll, 800);
    return () => clearInterval(interval);
  }, []);

  // ---- Tracking toggle ----
  const toggleTracking = useCallback(async () => {
    if (isTracking) {
      // The worker holds the journey, so it runs the whole shutdown: STOP to
      // the tracked tab, then finalise. Screenshots are the server's job now.
      setSession({ active: false });
      await sendToBackground({ action: 'SESSION_END' });
      return;
    }

    if (!resolved) return; // resolve not ready

    let pageUrl = '/';
    try { pageUrl = new URL(currentTab?.url ?? '/').pathname; } catch {}

    const res = await sendToBackground({
      action: 'SESSION_START',
      project_id: resolved.project_id,
      consumer_id: resolved.consumer_id,
      // Background needs the domain to decide, on every navigation, whether the
      // consumer is still on the brand's site.
      domain: resolved.domain,
      page_url: pageUrl,
    });

    if (res?.error === 'content_script_not_ready') {
      setStartError('Reload the page (F5), then start again.');
      return;
    }
    if (!res?.ok) {
      setStartError(res?.error ?? 'Could not start tracking.');
      return;
    }
    if (res?.ok) {
      setStartError(null);
      setSession({ active: true, session_id: res.session_id, pages_visited: 1, current_path: pageUrl });
    }
  }, [isTracking, resolved, currentTab]);

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

  // ---- Derived display ----
  const domain = currentTab?.url
    ? (() => { try { return new URL(currentTab.url).hostname; } catch { return '—'; } })()
    : '—';

  const canTrack = resolveStatus === 'ok';
  const pageCount = session.pages_visited ?? 0;

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

      {/* Live journey — a session now spans the whole site, so the page it
          started on is no longer the whole story. */}
      {isTracking && (
        <div className={`journey${session.paused ? ' journey--paused' : ''}`}>
          {session.paused ? (
            <p className="journey-state">⏸ Paused — off site</p>
          ) : (
            <p className="journey-state">● Recording</p>
          )}
          <p className="journey-detail">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'} this session
          </p>
          {session.current_path && !session.paused && (
            <p className="journey-path" title={session.current_path}>{session.current_path}</p>
          )}
        </div>
      )}

      <button className="btn calibrate" onClick={calibrate} disabled={isCalibrating}>
        {isCalibrating ? 'Calibrating…' : 'Calibrate'}
      </button>

      <button className={isDotVisible ? 'btn dot-on' : 'btn dot-off'} onClick={toggleDot} disabled={!isTracking}>
        {isDotVisible ? 'Hide Gaze Dot' : 'Show Gaze Dot'}
      </button>

      {startError && <p className="ss-note error">{startError}</p>}
    </div>
  );
};

const root = document.createElement('div');
document.body.appendChild(root);
ReactDOM.render(<App />, root);
