"""Gemini provider (optional): select with LLM_PROVIDER=gemini and GEMINI_API_KEY.

Plain REST over the standard library, same call the v1 harness used
(RSNA_ATLAS_MULTIMODAL/extract_cards.py), plus inline PDF input.
"""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request

from .base import Completion, ProviderError

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiProvider:
    name = "gemini"
    reads_pdf = True

    def __init__(self, model: str):
        self.model = model

    def is_configured(self) -> bool:
        return bool(os.environ.get("GEMINI_API_KEY"))

    def complete(self, system: str, user: str, pdf: bytes | None = None) -> Completion:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise ProviderError("No Gemini API key is configured. Add GEMINI_API_KEY to the "
                                ".env file and restart.", status=503)
        parts: list[dict] = []
        if pdf is not None:
            parts.append({"inline_data": {"mime_type": "application/pdf",
                                          "data": base64.standard_b64encode(pdf).decode("ascii")}})
        parts.append({"text": user})
        body = json.dumps({
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
        }).encode()
        request = urllib.request.Request(
            f"{API_ROOT}/{self.model}:generateContent", data=body,
            headers={"Content-Type": "application/json", "x-goog-api-key": key})

        payload = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=300) as response:
                    payload = json.loads(response.read())
                break
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 503) and attempt < 2:
                    time.sleep(10 * (attempt + 1))
                    continue
                if e.code in (401, 403):
                    raise ProviderError("The Gemini API key was rejected. Check GEMINI_API_KEY "
                                        "in the .env file.", status=503)
                if e.code == 429:
                    raise ProviderError("Gemini is rate-limiting this key. Wait a minute and "
                                        "try again.", status=429)
                raise ProviderError(f"Gemini returned an error ({e.code}).", status=502)
            except urllib.error.URLError:
                raise ProviderError("Could not reach Gemini. Check the server's internet "
                                    "connection.", status=502)

        candidates = (payload or {}).get("candidates") or []
        if not candidates:
            raise ProviderError("Gemini returned no answer for this document.", status=422)
        if candidates[0].get("finishReason") == "SAFETY":
            raise ProviderError("Gemini declined to process this document.", status=422)
        text = "".join(p.get("text", "") for p in candidates[0].get("content", {}).get("parts", []))
        meta = (payload or {}).get("usageMetadata", {})
        return Completion(text=text, model=self.model, usage={
            "input_tokens": meta.get("promptTokenCount", 0),
            "output_tokens": meta.get("candidatesTokenCount", 0) + meta.get("thoughtsTokenCount", 0),
        })
