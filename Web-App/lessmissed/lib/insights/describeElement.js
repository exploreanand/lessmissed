// Turns raw DOM identifiers into something a brand can actually read.
//
// The extension records elements as `tag + firstClass` (see contentScript
// resolveElementId), which produces rows like "img.image-image", "p", or
// "div.myx-base" in the insight tables. Those mean nothing to a marketer, so
// this resolves the best available human label from the signals we capture.
//
// Used as the fallback whenever a fixation does not fall inside a labelled
// screenshot region (see regionMap.js) — regions win when they exist because
// they also fix the identity-collapse problem that selectors can't.

// Nodes the extension paints on the page itself. They are instrumentation, not
// content, and must never appear in a brand-facing ranking.
const INSTRUMENT_IDS = new Set(["#webgazerGazeDot", "#webgazerFaceOverlay", "#webgazerVideoFeed"]);
const INSTRUMENT_PREFIXES = ["#webgazer", "#__lm_", ".__lm_"];

// Readable names for the tags we see most. Anything not listed falls back to
// the raw tag, which is still better than an empty string.
const TAG_NAMES = {
  a: "Link",
  button: "Button",
  img: "Image",
  h1: "Heading",
  h2: "Heading",
  h3: "Heading",
  h4: "Heading",
  h5: "Heading",
  h6: "Heading",
  p: "Paragraph",
  li: "List item",
  input: "Input field",
  select: "Dropdown",
  textarea: "Text area",
  form: "Form",
  nav: "Navigation",
  header: "Header",
  footer: "Footer",
  section: "Section",
  video: "Video",
  svg: "Icon",
};

// Layout containers. Their tag name adds nothing a brand can use, so when they
// carry text we show the text alone rather than prefixing it with "div:".
const GENERIC_CONTAINERS = new Set([
  "div", "span", "section", "main", "article", "aside", "ul", "ol", "figure", "label",
]);

// The page itself rather than a component in it.
const PAGE_LEVEL = new Set(["body", "html"]);

const MAX_LABEL = 60;

// Strict: is this one of the nodes *we* injected into the page? Such samples
// measure the instrument rather than the site, so they are dropped entirely
// during fixation derivation.
export function isOverlayElement(elementId) {
  if (!elementId) return false; // unresolved != ours; the gaze point is still real
  if (INSTRUMENT_IDS.has(elementId)) return true;
  return INSTRUMENT_PREFIXES.some((p) => elementId.startsWith(p));
}

// Loose: should this element be hidden from a brand-facing *ranking*? Covers
// our overlay plus ids that carry no meaning at all. The underlying gaze data
// is still kept — this only governs whether the row is worth naming.
export function isInstrumentElement(elementId) {
  if (!elementId) return true;
  return isOverlayElement(elementId);
}

// Carousel and pagination controls leave counter text like "1 2 3 4 SHOP BY
// CATEGORY" on the container. Strip those runs so the real name shows. Only
// runs of two or more *bare* digits are removed, so real copy like
// "50-80% OFF", "100% ORIGINAL" and "no. 1" survives untouched.
function cleanText(raw) {
  if (!raw) return "";
  let t = String(raw).replace(/\s+/g, " ").trim();
  t = t.replace(/(?:^|\s)\d+(?:\s+\d+)+(?=\s|$)/g, " ");  // "A 1 2 3 B" -> "A B"
  t = t.replace(/\b(?:Previous|Next)\b/gi, " ");
  return t.replace(/\s+/g, " ").trim();
}

// "/assets/rising-stars_banner.jpg" -> "Rising stars banner"
function humanizeSrc(src) {
  if (!src) return "";
  const base = String(src).split("?")[0].split("/").pop() ?? "";
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  if (!stem) return "";
  const words = stem.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  // Hashed asset names ("a3f9c2e1", "1x1") carry no meaning — reject them.
  if (!/[a-z]{3}/i.test(words)) return "";
  if (/^[0-9a-f]{8,}$/i.test(stem)) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Exported so the OCR and VLM rungs cap their labels the same way — a whole
// SEO paragraph read off the page is not a component name.
export function truncateLabel(s) {
  const t = String(s).trim();
  return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1).trimEnd()}…` : t;
}

function truncate(s) {
  return truncateLabel(s);
}

function tagName(tag) {
  if (!tag) return "Element";
  return TAG_NAMES[String(tag).toLowerCase()] ?? String(tag).toLowerCase();
}

/**
 * Best-effort human label for a single element.
 *
 * @param {object} el
 * @param {string} [el.element_id]     e.g. "img.image-image"
 * @param {string} [el.element_tag]    e.g. "img"
 * @param {string} [el.element_text]   textContent (empty for images)
 * @param {string} [el.element_alt]    img alt
 * @param {string} [el.element_aria]   aria-label
 * @param {string} [el.element_title]  title attribute
 * @param {string} [el.element_src]    img src
 * @param {string} [el.element_xpath]  "div.foo > div.bar > p"
 * @returns {{label: string, source: string, instrument: boolean}}
 */
export function describeElement(el = {}) {
  const {
    element_id: id,
    element_tag: tag,
    element_text: text,
    element_alt: alt,
    element_aria: aria,
    element_title: title,
    element_src: src,
  } = el;

  if (isInstrumentElement(id)) {
    return { label: "LessMissed overlay", source: "instrument", instrument: true };
  }

  const tagLower = String(tag ?? "").toLowerCase();
  const kind = tagName(tag);
  const generic = GENERIC_CONTAINERS.has(tagLower);

  // The whole page is not a component — name it so it reads as scaffolding
  // rather than competing with real components in a ranking.
  if (PAGE_LEVEL.has(tagLower)) {
    return { label: "Page background", source: "selector", instrument: false };
  }

  // 1. Author-supplied accessible names are the most reliable signal we have.
  const ariaClean = cleanText(aria);
  if (ariaClean) return { label: truncate(ariaClean), source: "aria", instrument: false };

  const altClean = cleanText(alt);
  if (altClean) return { label: truncate(altClean), source: "alt", instrument: false };

  const titleClean = cleanText(title);
  if (titleClean) return { label: truncate(titleClean), source: "title", instrument: false };

  // 2. Visible text, qualified by what kind of thing it is. Headings and links
  //    read well bare; a long paragraph needs the prefix to stay scannable.
  const textClean = cleanText(text);
  if (textClean.length >= 2) {
    // Layout containers read better as bare text ("Online shopping made easy"),
    // while semantic tags earn their prefix ("Heading: Rising Stars") because
    // the distinction between a heading and body copy is itself actionable.
    return {
      label: truncate(generic ? textClean : `${kind}: ${textClean}`),
      source: "text",
      instrument: false,
    };
  }

  // 3. Images have no text — the filename is often the only DOM-side clue.
  const srcClean = humanizeSrc(src);
  if (srcClean) return { label: truncate(`${kind}: ${srcClean}`), source: "src", instrument: false };

  // 4. Nothing semantic survived — typically an <img> whose alt/src the
  //    extension has not captured yet. The screenshot region map (regionMap.js
  //    + OCR/VLM) is what resolves these; until then the row shows its kind and
  //    raw selector so the gap stays visible instead of silently mislabelled.
  return {
    label: id ? `${kind} (${id})` : kind,
    source: "selector",
    instrument: false,
  };
}
