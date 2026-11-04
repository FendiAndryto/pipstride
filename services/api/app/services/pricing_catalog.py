"""Load the single-source pricing catalogue (ADR 0007).

The file is plain JSON, not a published package. Relative paths resolve from
the repository root so the API behaves the same from ``services/api`` and from
the production image, which keeps the repository layout under ``/repo``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings

_REPO_ROOT = Path(__file__).resolve().parents[4]


class PricingCatalogError(RuntimeError):
    """Raised when the pricing catalogue is missing or malformed."""


@dataclass(frozen=True)
class CatalogPlan:
    code: str
    name: str
    max_connections: int
    price_cents: int


def catalog_path() -> Path:
    path = Path(settings.PRICING_CATALOG_PATH).expanduser()
    if path.is_absolute():
        return path
    return (_REPO_ROOT / path).resolve()


def _require_string(item: dict, key: str, index: int) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise PricingCatalogError(f"plans[{index}].{key} must be a non-empty string")
    return value.strip()


def _require_int(item: dict, key: str, index: int, *, minimum: int = 0) -> int:
    value = item.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise PricingCatalogError(
            f"plans[{index}].{key} must be an integer >= {minimum}"
        )
    return value


def load_plans(path: Path | None = None) -> list[CatalogPlan]:
    target = path or catalog_path()

    try:
        raw = target.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise PricingCatalogError(f"Pricing catalog not found: {target}") from exc
    except OSError as exc:
        raise PricingCatalogError(f"Pricing catalog unreadable: {target}: {exc}") from exc

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PricingCatalogError(
            f"Pricing catalog is not valid JSON: {target}: {exc}"
        ) from exc

    if not isinstance(payload, dict):
        raise PricingCatalogError("Pricing catalog root must be a JSON object")
    if payload.get("version") != 1:
        raise PricingCatalogError(
            f"Unsupported pricing catalog version: {payload.get('version')!r}"
        )

    items = payload.get("plans")
    if not isinstance(items, list) or not items:
        raise PricingCatalogError("Pricing catalog must contain a non-empty 'plans' list")

    plans: list[CatalogPlan] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise PricingCatalogError(f"plans[{index}] must be a JSON object")
        code = _require_string(item, "code", index)
        if code in seen:
            raise PricingCatalogError(f"Duplicate plan code: {code}")
        seen.add(code)
        plans.append(
            CatalogPlan(
                code=code,
                name=_require_string(item, "name", index),
                max_connections=_require_int(
                    item, "max_connections", index, minimum=1
                ),
                price_cents=_require_int(item, "price_cents", index),
            )
        )
    return plans
