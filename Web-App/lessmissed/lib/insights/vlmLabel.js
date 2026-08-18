// Client for the self-hosted vision labelling service (label-service/).
//
// The last rung of the ladder, reached only for regions that alt/aria text, DOM
// text and OCR all failed to name — in practice the purely pictorial ones. If
// the service is not running the pipeline degrades quietly: those regions keep
// their selector-derived label rather than the whole labelling run failing.

const ENDPOINT = process.env.LM_LABEL_SERVICE_URL ?? "http://127.0.0.1:8077";
const TIMEOUT_MS = 20_000;

let unavailableLogged = false;

export async function isLabelServiceUp() {
  try {
    const res = await fetch(`${ENDPOINT}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Caption a single cropped region.
 *
 * @param {Buffer} cropBuffer PNG/JPEG bytes of the region crop
 * @returns {Promise<{label:string, source:string}|null>} null when unavailable
 */
export async function labelRegionCrop(cropBuffer) {
  try {
    const res = await fetch(`${ENDPOINT}/label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_b64: cropBuffer.toString("base64"), task: "<CAPTION>" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.label ? { label: data.label, source: "vlm" } : null;
  } catch (err) {
    if (!unavailableLogged) {
      unavailableLogged = true;
      console.warn(
        `[label-service] unavailable at ${ENDPOINT} (${err.message}); ` +
          "unnamed regions keep their selector labels"
      );
    }
    return null;
  }
}
