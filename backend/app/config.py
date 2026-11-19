"""All configuration comes from environment variables (see .env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MODELS = {
    "anthropic": "claude-fable-5-2",
    "gemini": "gemini-2.5-pro",
}


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


@dataclass(frozen=True)
class Settings:
    llm_provider: str
    llm_model: str
    llm_effort: str
    anthropic_fallbacks: str
    pdf_mode: str
    max_upload_mb: int
    cors_origins: tuple[str, ...]
    static_dir: Path

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


def load_settings() -> Settings:
    provider = _env("LLM_PROVIDER", "anthropic").lower()
    return Settings(
        llm_provider=provider,
        llm_model=_env("LLM_MODEL") or DEFAULT_MODELS.get(provider, ""),
        llm_effort=_env("LLM_EFFORT", "medium").lower(),
        anthropic_fallbacks=_env("ANTHROPIC_FALLBACKS", "default").lower(),
        pdf_mode=_env("PDF_MODE", "native").lower(),
        max_upload_mb=int(_env("MAX_UPLOAD_MB", "20")),
        cors_origins=tuple(o.strip() for o in _env("CORS_ORIGINS").split(",") if o.strip()),
        static_dir=Path(_env("STATIC_DIR", "/app/static")),
    )
