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

  for (const pt of points) {
    const x = pt.x * scaleX;
    const y = pt.y * scaleY;
    const r = Math.max(20, Math.min(80, (pt.value ?? 1) * 8));

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);

    const intensity = pt.value ?? 1;
    const color =
      intensity >= 7  ? colors.hot  :
      intensity >= 4  ? colors.warm :
      intensity >= 2  ? colors.cool :
                        colors.cold;

    gradient.addColorStop(0,   color + "cc");
    gradient.addColorStop(0.4, color + "55");
    gradient.addColorStop(1,   color + "00");

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Scroll-depth band overlay — positioned proportionally across the full page
// ---------------------------------------------------------------------------
function ScrollDepthChart({ bands }) {
  if (!bands?.length) return null;
  const max = Math.max(...bands.map((b) => b.session_count), 1);
  return (
    <>
      {bands.map((b) => {
        const opacity = b.session_count / max;
        return (
          <div
            key={b.band}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${b.min}%`,
              height: `${b.max - b.min}%`,
              backgroundColor: `rgba(239, 68, 68, ${opacity * 0.45})`,
              borderBottom: "1px solid rgba(239, 68, 68, 0.15)",
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 10,
                color: "white",
                textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                fontFamily: "sans-serif",
              }}
            >
              {b.band} · {b.session_count}
            </span>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HeatmapViewer({ projectId, pageSlug }) {
  const [mode, setMode]               = useState("gaze");
  const [screenshot, setScreenshot]   = useState(null);
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

    const pageW = screenshot?.viewport_width  || container.clientWidth;
    const pageH = screenshot?.document_height || container.clientHeight;

    // Canvas pixel dimensions match the inner page proportions
    const w = container.clientWidth;
    const h = Math.round(w * pageH / pageW);

    canvas.width  = w;
    canvas.height = h;

    renderHeatmap(canvas, points, w, h, pageW, pageH, MODE_COLORS[mode]);
  }, [points, screenshot, mode, scrollBands]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Redraw on outer container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(redraw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  // Padding-bottom % that gives the inner page its natural aspect ratio
  const innerPagePadding =
    screenshot?.viewport_width && screenshot?.document_height
      ? `${(screenshot.document_height / screenshot.viewport_width) * 100}%`
      : "56.25%"; // 16:9 fallback

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

      {/* ── Outer 16:9 viewport — clips the view, never scrolls ── */}
      <div
        ref={containerRef}
        className="relative w-full rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800"
        style={{ aspectRatio: "16 / 9" }}
      >
        {/* Inner scrollable pane — hides the scrollbar visually */}
        <div
          className="absolute inset-0 overflow-y-auto"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {/* Inner page — proportional to full document height */}
          <div style={{ position: "relative", width: "100%", paddingBottom: innerPagePadding }}>

            {/* Screenshot */}
            {screenshot?.url && (
              <img
                src={screenshot.url}
                alt="Page screenshot"
                className="absolute inset-0 w-full h-full select-none pointer-events-none"
                draggable={false}
              />
            )}

            {/* Heatmap canvas */}
            {mode !== "scroll" && (
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ mixBlendMode: "multiply" }}
              />
            )}

            {/* Scroll depth bands — overlaid on the full page height */}
            {mode === "scroll" && scrollBands && (
              <ScrollDepthChart bands={scrollBands} />
            )}

          </div>
        </div>

        {/* ── Non-scrolling overlays — always visible in the 16:9 window ── */}

        {/* Skeleton when screenshot is loading */}
        {!screenshot?.url && !noScreenshot && (
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

        {/* Empty data notice */}
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

        {/* Fixed nav overlay — mirrors how the real site shows the navbar over scrolled content */}
        {screenshot?.header_url && screenshot.header_height > 0 && (
          <div
            style={{
              position: "absolute",
              top: 0, left: 0, right: 0,
              zIndex: 20,
              aspectRatio: `${screenshot.viewport_width} / ${screenshot.header_height}`,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            <img
              src={screenshot.header_url}
              alt=""
              className="w-full block select-none pointer-events-none"
              draggable={false}
            />
          </div>
        )}
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