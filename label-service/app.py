"""Self-hosted vision labelling service.

The last rung of the labelling ladder. Everything cheaper runs first in the
Node pipeline — author-supplied alt/aria/title, visible DOM text, Tesseract OCR
on the screenshot, image filename — and roughly 89% of regions are named by
those alone. This service exists for the remainder: purely pictorial regions
with no text anywhere, such as a lifestyle photo in a hero carousel.

Florence-2-base (MIT, ~0.23B) is the default because one model covers
captioning, OCR and region proposals, and it runs on CPU at the volume this
needs — labelling happens once per page screenshot version, offline, never in a
user request path.

Run:
    pip install -r requirements.txt
    uvicorn app:app --port 8077
"""

from __future__ import annotations

import base64
import io
import os
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

MODEL_ID = os.environ.get("LM_VLM_MODEL", "microsoft/Florence-2-base")
MAX_LABEL_CHARS = 60

app = FastAPI(title="LessMissed label service")

_model = None
_processor = None


def _load():
    """Load lazily so importing the module (and /health) stays cheap."""
    global _model, _processor
    if _model is not None:
        return _model, _processor

    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor

    _model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, trust_remote_code=True, torch_dtype=torch.float32
    ).eval()
    _processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
    return _model, _processor


class LabelRequest(BaseModel):
    # Base64 PNG/JPEG of the *cropped region*, not the whole page — captioning a
    # full 6000px screenshot returns something useless like "a web page".
    image_b64: str = Field(..., description="base64-encoded crop of the region")
    task: str = Field("<CAPTION>", description="Florence-2 task token")


class LabelResponse(BaseModel):
    label: Optional[str]
    source: str = "vlm"
    model: str = MODEL_ID


def _tidy(text: str) -> str:
    """Captions arrive as sentences; a ranking row needs a short noun phrase."""
    t = " ".join((text or "").split())
    for prefix in ("The image shows ", "This image shows ", "The image is ", "A picture of "):
        if t.lower().startswith(prefix.lower()):
            t = t[len(prefix):]
            break
    t = t.rstrip(".")
    if t:
        t = t[0].upper() + t[1:]
    if len(t) > MAX_LABEL_CHARS:
        t = t[: MAX_LABEL_CHARS - 1].rstrip() + "…"
    return t


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "loaded": _model is not None}


@app.post("/label", response_model=LabelResponse)
def label(req: LabelRequest):
    from PIL import Image

    model, processor = _load()
    image = Image.open(io.BytesIO(base64.b64decode(req.image_b64))).convert("RGB")

    inputs = processor(text=req.task, images=image, return_tensors="pt")
    generated = model.generate(
        input_ids=inputs["input_ids"],
        pixel_values=inputs["pixel_values"],
        max_new_tokens=64,
        num_beams=3,
        do_sample=False,
    )
    raw = processor.batch_decode(generated, skip_special_tokens=False)[0]
    parsed = processor.post_process_generation(
        raw, task=req.task, image_size=(image.width, image.height)
    )

    text = parsed.get(req.task) if isinstance(parsed, dict) else None
    if isinstance(text, dict):
        text = text.get("labels", [None])[0]

    tidy = _tidy(text or "")
    return LabelResponse(label=tidy or None)
