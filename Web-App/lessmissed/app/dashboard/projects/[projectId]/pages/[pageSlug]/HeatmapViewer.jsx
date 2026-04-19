"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const MODES = ["gaze", "click", "scroll", "cursor"];

const MODE_COLORS = {
  gaze:   { hot: "#ef4444", warm: "#f97316", cool: "#eab308", cold: "#22c55e" },
  click:  { hot: "#3b82f6", warm: "#6366f1", cool: "#8b5cf6", cold: "#a78bfa" },
  scroll: { hot: "#ef4444", warm: "#f97316", cool: "#eab308", cold: "#22c55e" },
  cursor: { hot: "#06b6d4", warm: "#0ea5e9", cool: "#38bdf8", cold: "#7dd3fc" },
};

// ---------------------------------------------------------------------------
// Canvas-based heatmap renderer
// ---------------------------------------------------------------------------
function renderHeatmap(canvas, points, containerWidth, containerHeight, pageWidth, pageHeight, colors) {
  if (!canvas || !points.length) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, containerWidth, containerHeight);

  const scaleX = containerWidth  / (pageWidth  || containerWidth);
  const scaleY = containerHeight / (pageHeight || containerHeight);

  // Draw each point as a radial gradient blob
  for (const pt of points) {
    const x = pt.x * scaleX;
    const y = pt.y * scaleY;
    // Radius grows with intensity (value 0-10)
    const r = Math.max(20, Math.min(80, (pt.value ?? 1) * 8));

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);

    // Pick color tier based on relative intensity
    const intensity = pt.value ?? 1;
    const color =
      intensity >= 7  ? colors.hot  :
      intensity >= 4  ? colors.warm :
      intensity >= 2  ? colors.cool :
                        colors.cold;

    gradient.addColorStop(0,   color + "cc"); // ~80% opacity at centre
    gradient.addColorStop(0.4, color + "55"); // ~33% mid
    gradient.addColorStop(1,   color + "00"); // transparent edge

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Scroll-depth bar chart (used for "scroll" mode instead of blob heatmap)
// ---------------------------------------------------------------------------
function ScrollDepthChart({ bands }) {
  if (!bands?.length) return null;
  const max = Math.max(...bands.map((b) => b.session_count), 1);
  return (
    <div className="absolute inset-0 flex items-end px-4 pb-4 gap-1">
      {bands.map((b) => {
        const pct = Math.round((b.session_count / max) * 100);
        return (
          <div key={b.band} className="flex flex-col items-center flex-1 gap-1">
            <div
              className="w-full rounded-t-sm bg-violet-500 opacity-70 transition-all"
              style={{ height: `${pct}%`, minHeight: pct > 0 ? 2 : 0 }}
            />
            <span className="text-[8px] text-zinc-400 rotate-45 origin-left whitespace-nowrap">
              {b.band}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HeatmapViewer({ projectId, pageSlug }) {
  const [mode, setMode]               = useState("gaze");
  const [screenshot, setScreenshot]   = useState(null);  // { url, viewport_width, document_height }
  const [points, setPoints]           = useState([]);
  const [scrollBands, setScrollBands] = useState(null);
  const [loading, setLoading]         = useState(false);
  const [noScreenshot, setNoScreenshot] = useState(false);

  const containerRef = useRef(null);
  const canvasRef    = useRef(null);

  // ---- Fetch screenshot metadata ----
  useEffect(() => {
    if (!projectId || !pageSlug) return;
    fetch(`/api/projects/${projectId}/pages/${pageSlug}/screenshot`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.url) {
          setScreenshot(data);
          setNoScreenshot(false);
        } else {
          setNoScreenshot(true);
        }
      })
      .catch(() => setNoScreenshot(true));
  }, [projectId, pageSlug]);

  // ---- Fetch heatmap points when mode changes ----
  useEffect(() => {
    if (!projectId || !pageSlug) return;
    setLoading(true);
    setPoints([]);
    setScrollBands(null);

    fetch(`/api/projects/${projectId}/pages/${pageSlug}/heatmap?type=${mode}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.scroll_depth_bands) {
          setScrollBands(data.scroll_depth_bands);
        } else {
          setPoints(data.points ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [mode, projectId, pageSlug]);

  // ---- Re-render canvas whenever points or container size changes ----
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || scrollBands) return;

    const { width, height } = container.getBoundingClientRect();
    canvas.width  = width;
    canvas.height = height;

    const pageW = screenshot?.viewport_width  || width;
    const pageH = screenshot?.document_height || height;

    renderHeatmap(canvas, points, width, height, pageW, pageH, MODE_COLORS[mode]);
  }, [points, screenshot, mode, scrollBands]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Redraw on container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(redraw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  // ---- Aspect ratio: match screenshot proportions or fall back to 16/9 ----
  const aspectRatio =
    screenshot?.viewport_width && screenshot?.document_height
      ? `${screenshot.viewport_width} / ${screenshot.document_height}`
      : "16 / 9";

  return (
    <div className="space-y-3">
      {/* Mode tabs */}
      <div className="flex gap-1 flex-wrap">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
              mode === m
                ? "bg-violet-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {m}
          </button>
        ))}

        {/* Point count badge */}
        {!loading && points.length > 0 && (
          <span className="ml-auto self-center text-xs text-zinc-400">
            {points.length.toLocaleString()} data points
          </span>
        )}
        {loading && (
          <span className="ml-auto self-center text-xs text-zinc-400 animate-pulse">
            Loading…
          </span>
        )}
      </div>

      {/* Viewer */}
      <div
        ref={containerRef}
        className="relative w-full rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800"
        style={{ aspectRatio }}
      >
        {/* Screenshot background */}
        {screenshot?.url ? (
          <img
            src={screenshot.url}
            alt="Page screenshot"
            className="absolute inset-0 w-full h-full object-cover object-top select-none pointer-events-none"
            draggable={false}
          />
        ) : (
          /* Skeleton when no screenshot */
          <div className="absolute inset-0 p-6 flex flex-col gap-4 pointer-events-none select-none">
            <div className="flex items-center justify-between">
              <div className="h-3 w-20 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              <div className="flex gap-3">
                {[40, 32, 36].map((w, i) => (
                  <div key={i} className="h-2.5 rounded-full bg-zinc-300 dark:bg-zinc-600" style={{ width: w }} />
                ))}
              </div>
              <div className="h-7 w-20 rounded-lg bg-zinc-300 dark:bg-zinc-600" />
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <div className="h-5 w-64 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              <div className="h-3 w-48 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-9 w-32 rounded-full bg-zinc-300 dark:bg-zinc-600 mt-2" />
            </div>
          </div>
        )}

        {/* Heatmap canvas overlay */}
        {mode !== "scroll" && (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ mixBlendMode: "multiply" }}
          />
        )}

        {/* Scroll depth bar chart */}
        {mode === "scroll" && scrollBands && (
          <div className="absolute inset-0 bg-white/30 dark:bg-zinc-900/40">
            <ScrollDepthChart bands={scrollBands} />
          </div>
        )}

        {/* No screenshot notice */}
        {noScreenshot && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm">
            <div className="text-center px-6">
              <p className="text-sm font-semibold text-white">No page screenshot yet</p>
              <p className="text-xs text-zinc-300 mt-1">
                Use the LessMissed extension → <strong>Capture page</strong> while on this URL
              </p>
            </div>
          </div>
        )}

        {/* Empty data notice (screenshot exists, but no events yet) */}
        {!noScreenshot && !loading && points.length === 0 && !scrollBands && (
          <div className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1.5">
            <p className="text-xs text-zinc-300">No {mode} data yet for this page</p>
          </div>
        )}

        {/* Colour legend */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-white/80 dark:bg-zinc-900/80 px-2.5 py-1.5 backdrop-blur-sm">
          <div className="flex gap-0.5">
            {Object.values(MODE_COLORS[mode]).reverse().map((c) => (
              <div key={c} className="h-2 w-4 rounded-sm" style={{ background: c }} />
            ))}
          </div>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Low → High</span>
        </div>
      </div>

      {/* Screenshot status footer */}
      {screenshot?.captured_at && (
        <p className="text-xs text-zinc-400">
          Screenshot captured{" "}
          {new Date(screenshot.captured_at).toLocaleDateString("en-IN", {
            day: "numeric", month: "short", year: "numeric",
          })}
          {screenshot.document_height && (
            <> · {screenshot.viewport_width}×{screenshot.document_height}px full page</>
          )}
        </p>
      )}
    </div>
  );
}
