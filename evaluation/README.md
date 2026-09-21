LessMissed — evaluation harness
===============================

Three experiments for the paper's results section. Experiment D
(self-occlusion) needs no network and has already been run; these three need
live pages, so they must run on a machine with internet access.

Setup
-----
    cd harness
    npm install
    npx playwright install chromium

Both scripts need the LessMissed repository, because they import the
project's own `describeElement.js` rather than reimplementing the ladder.
Pass `--repo` if the harness is not sitting next to it:

    node expAB_identity.mjs urls.txt --repo /path/to/LESSMISSED

Experiment A + B — identity collision and label coverage
--------------------------------------------------------
    node expAB_identity.mjs urls.txt --out resultsAB.json

Enumerates the components on each page (visible, at least 24 px on a side,
and either an atomic control/media element, a node carrying its own text, or
a node painting its own background image; container elements are dropped so
each thing is counted once). For each component it computes the three
identities the paper compares — the DOM selector, the positional key, and the
document-space box — and asks `describeElement` which ladder rung names it.

Reports per page and in total:
  components, distinctSelectors, distinctPositionalKeys, distinctBoxes
  componentsSharingASelector, selectorCollisionRate, largestSelectorBucket
  labelSource  (aria | alt | title | text | src | selector)
  needsPixelEvidence  (fell through every DOM rung: the OCR/VLM workload)

Experiment C — pipeline cost
----------------------------
    node expC_timing.mjs urls.txt --out resultsC.json

Times the scroll-and-stitch capture, the stitch itself, and Tesseract OCR of
the stitched screenshot. Capture is reported both as total wall clock and
with the mandated 520 ms inter-capture spacing subtracted — the browser caps
tab capture at two per second, so that wait belongs to the platform, not to
this pipeline.

To include the vision-language rung, start the label service first:

    cd ../label-service && uvicorn app:app --port 8077
    node expC_timing.mjs urls.txt --label-service http://127.0.0.1:8077

`vlmCaptionMs` is null when the service is not reachable.

Notes
-----
Run on a normal broadband connection, not a VPN or throttled link; capture
and OCR timings are sensitive to page weight. Re-run twice and keep the
second run, so cold DNS and cold Tesseract model download are excluded.
The OCR model (~5 MB) downloads on first use.

Send me resultsAB.json and resultsC.json and I will write the numbers into
the paper.
