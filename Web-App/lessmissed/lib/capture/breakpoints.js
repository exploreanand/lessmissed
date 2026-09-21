// Canonical capture widths, and the rule that assigns a session to one.
//
// The screenshot is the coordinate frame for every overlay drawn on it, so a
// session recorded at 1280 CSS px cannot be plotted on a render taken at 390 —
// the layout reflowed in between. The old design ignored this entirely: it
// captured in a fixed 1440x900 window and drew every session on that image
// regardless of the width it was recorded at, with no rescaling anywhere.
//
// Rather than render every page at every width a consumer might use, pages are
// captured at a small set of canonical widths and each session is bucketed to
// the nearest one. Within a bucket the residual error is sub-breakpoint reflow,
// which is small; across buckets it was a different layout entirely.
//
// Plain ESM with no "@/" alias, like pathTemplate.js and deriveFixations.js, so
// the capture worker and the backfill scripts can import it under bare Node.

/**
 * The width each breakpoint renders at, in CSS pixels.
 *
 * device_scale_factor is 1 deliberately. The stored image must be exactly
 * viewport_width x captured_height CSS pixels — that is the coordinate contract
 * every overlay depends on — so a 2x capture is downscaled straight back to 1x
 * before it is written. The only thing the extra resolution buys is nicer
 * antialiasing, and it costs four times the raster: a 28000 px page at 2x is
 * 2880 x 56000, roughly 645 MB of pixels for Chromium to hold and sharp to
 * resize. Tall pages simply stall. Supersampling is not worth that.
 */
export const BREAKPOINTS = {
  desktop: { width: 1440, height: 900, device_scale_factor: 1 },
  mobile: { width: 390, height: 844, device_scale_factor: 1 },
};

export const DEFAULT_BREAKPOINT = "desktop";

// Anything at or below this is treated as a phone. Chosen at the common
// tablet/desktop CSS breakpoint rather than midway between 390 and 1440: a
// 768-wide tablet is served the narrow layout by most sites, so it belongs
// with mobile even though 768 is numerically closer to 1440.
const MOBILE_MAX_WIDTH = 768;

/**
 * Which canonical capture does a session recorded at this width belong to?
 *
 * Returns DEFAULT_BREAKPOINT for a missing width — sessions recorded before
 * viewport reporting existed have no answer, and desktop is what the old
 * capture window used, so it is the least wrong assumption for that data.
 */
export function breakpointForWidth(viewportWidth) {
  const width = Number(viewportWidth);
  if (!Number.isFinite(width) || width <= 0) return DEFAULT_BREAKPOINT;
  return width <= MOBILE_MAX_WIDTH ? "mobile" : "desktop";
}

/** Render profile for a breakpoint name, falling back to desktop. */
export function profileFor(breakpoint) {
  return BREAKPOINTS[breakpoint] ?? BREAKPOINTS[DEFAULT_BREAKPOINT];
}

/** Is this a breakpoint we know how to render? */
export function isValidBreakpoint(breakpoint) {
  return Object.prototype.hasOwnProperty.call(BREAKPOINTS, String(breakpoint));
}
