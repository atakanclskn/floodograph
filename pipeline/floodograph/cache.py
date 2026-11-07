"""Pipes & Filters cache: each step's output is stored on disk keyed by step name + parameter digest.

Re-running the pipeline skips steps whose inputs did not change; deleting one file re-runs only that step.
"""
from __future__ import annotations

import functools
import hashlib
import json
import pickle
from pathlib import Path
from typing import Any, Callable, TypeVar

from .config import DATA_DIR

T = TypeVar("T")


def _digest(params: dict[str, Any]) -> str:
    blob = json.dumps(params, sort_keys=True, default=str).encode()
    return hashlib.sha1(blob).hexdigest()[:10]


def cached(step: str) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Cache a step's return value (pickled). Keyword args form the cache key; first positional is the city."""

    def deco(fn: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(fn)
        def wrapper(city, *args: Any, force: bool = False, **kwargs: Any) -> T:
            key = _digest({"city": city.id, "args": args, "kwargs": kwargs})
            path: Path = DATA_DIR / city.id / "cache" / f"{step}-{key}.pkl"
            if path.exists() and not force:
                with path.open("rb") as f:
                    return pickle.load(f)
            result = fn(city, *args, **kwargs)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            with tmp.open("wb") as f:
                pickle.dump(result, f, protocol=pickle.HIGHEST_PROTOCOL)
            tmp.replace(path)
            return result

        return wrapper

    return deco
