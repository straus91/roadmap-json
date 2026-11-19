"""All configuration comes from environment variables (see .env.example)."""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5-5",
    "gemini": "gemini-4-hydrogen",
}

# List prices in USD per million tokens (input, output), used to show what each card cost and
# to enforce the monthly budget. Override with PRICE_INPUT_PER_MTOK / PRICE_OUTPUT_PER_MTOK.
PRICES = {
    "gemini-4-hydrogen": (1.50, 7.50),
    "gemini-4-argon": (2.00, 10.00),
    "gemini-4-carbon": (2.00, 10.00),
    "gemini-3-flash-preview": (0.50, 3.00),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-fable-5-2": (8.00, 40.00),
}
FALLBACK_PRICE = (2.00, 10.00)  # for a model not listed above: assume mid-tier, not free


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
    max_pdf_pages: int
    monthly_budget_usd: float
    daily_limit_per_visitor: int
    price_per_mtok: tuple[float, float]
    price_is_known: bool
    schema_sync_hours: float
    data_dir: Path
    cors_origins: tuple[str, ...]
    static_dir: Path

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def cost_usd(self, usage: dict[str, int]) -> float:
        """What a request cost at list price. Cached input is billed differently by
        Anthropic (reads 0.1x, writes 1.25x); other providers report plain input/output."""
        price_in, price_out = self.price_per_mtok
        tokens_in = (usage.get("input_tokens", 0)
                     + 0.1 * usage.get("cache_read_input_tokens", 0)
                     + 1.25 * usage.get("cache_creation_input_tokens", 0))
        return round((tokens_in * price_in + usage.get("output_tokens", 0) * price_out) / 1e6, 4)


def load_settings() -> Settings:
    provider = _env("LLM_PROVIDER", "anthropic").lower()
    model = _env("LLM_MODEL") or DEFAULT_MODELS.get(provider, "")
    override = (_env("PRICE_INPUT_PER_MTOK"), _env("PRICE_OUTPUT_PER_MTOK"))
    if all(override):
        price, known = (float(override[0]), float(override[1])), True
    else:
        price, known = PRICES.get(model, FALLBACK_PRICE), model in PRICES
    return Settings(
        llm_provider=provider,
        llm_model=model,
        llm_effort=_env("LLM_EFFORT", "medium").lower(),
        anthropic_fallbacks=_env("ANTHROPIC_FALLBACKS", "default").lower(),
        pdf_mode=_env("PDF_MODE", "native").lower(),
        max_upload_mb=int(_env("MAX_UPLOAD_MB", "20")),
        max_pdf_pages=int(_env("MAX_PDF_PAGES", "50")),
        monthly_budget_usd=float(_env("MONTHLY_BUDGET_USD", "50")),
        daily_limit_per_visitor=int(_env("DAILY_LIMIT_PER_VISITOR", "5")),
        price_per_mtok=price,
        price_is_known=known,
        schema_sync_hours=float(_env("SCHEMA_SYNC_HOURS", "24")),
        data_dir=Path(_env("DATA_DIR") or Path(tempfile.gettempdir()) / "roadmap-cards"),
        cors_origins=tuple(o.strip() for o in _env("CORS_ORIGINS").split(",") if o.strip()),
        static_dir=Path(_env("STATIC_DIR", "/app/static")),
    )
