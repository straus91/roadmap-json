"""Spending guard for a public site that pays for every paper it reads.

Two limits, both checked before a paper is sent to the model:
* a monthly budget in dollars (the sum of what each extraction actually cost), and
* a number of papers per visitor per day, so one visitor cannot use the whole month.

The ledger is one small JSON file in DATA_DIR. Visitors are stored as a salted hash, never as
an address. This is the friendly limit; the hard backstop is a spend limit on the API key
itself, set in the provider's console.
"""
from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .providers.base import ProviderError


class Ledger:
    def __init__(self, path: Path, monthly_budget_usd: float, daily_limit_per_visitor: int):
        self.path = path
        self.monthly_budget_usd = monthly_budget_usd
        self.daily_limit_per_visitor = daily_limit_per_visitor
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ storage
    @staticmethod
    def _today() -> tuple[str, str]:
        now = datetime.now(timezone.utc)
        return now.strftime("%Y-%m"), now.strftime("%Y-%m-%d")

    def _read(self) -> dict[str, Any]:
        month, day = self._today()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        if data.get("month") != month:                      # a new month starts from zero
            data = {"month": month, "spent_usd": 0.0, "papers": 0}
        if data.get("day") != day:
            data["day"], data["visitors"] = day, {}
        return data

    def _write(self, data: dict[str, Any]) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(json.dumps(data), encoding="utf-8")
            temporary.replace(self.path)
        except OSError:
            pass  # a read-only disk must not take the site down; the provider cap still holds

    def _visitor(self, address: str, day: str) -> str:
        return hashlib.sha256(f"{day}|{address}".encode()).hexdigest()[:16]

    # ------------------------------------------------------------------- limits
    def check(self, address: str) -> None:
        """Raise a user-facing error when this visitor may not start another extraction."""
        with self._lock:
            data = self._read()
            if self.monthly_budget_usd > 0 and data["spent_usd"] >= self.monthly_budget_usd:
                raise ProviderError(
                    "This month's budget for reading papers has been used up, so creating cards "
                    "from a PDF is paused until the 1st. You can still open, edit, check and "
                    "download cards.", status=429)
            used = data["visitors"].get(self._visitor(address, data["day"]), 0)
            if self.daily_limit_per_visitor > 0 and used >= self.daily_limit_per_visitor:
                raise ProviderError(
                    f"You have reached today's limit of {self.daily_limit_per_visitor} papers. "
                    "Please come back tomorrow. You can still open, edit, check and download "
                    "cards.", status=429)

    def record(self, address: str, cost_usd: float) -> None:
        with self._lock:
            data = self._read()
            data["spent_usd"] = round(data["spent_usd"] + cost_usd, 4)
            data["papers"] += 1
            visitor = self._visitor(address, data["day"])
            data["visitors"][visitor] = data["visitors"].get(visitor, 0) + 1
            self._write(data)

    def summary(self) -> dict[str, Any]:
        with self._lock:
            data = self._read()
        remaining = max(self.monthly_budget_usd - data["spent_usd"], 0.0)
        return {"month": data["month"], "monthly_budget_usd": self.monthly_budget_usd,
                "spent_usd": round(data["spent_usd"], 2), "papers_this_month": data["papers"],
                "paused": self.monthly_budget_usd > 0 and remaining <= 0,
                "daily_limit_per_visitor": self.daily_limit_per_visitor}
