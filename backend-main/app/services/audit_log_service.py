from __future__ import annotations

import json
import os
from collections import Counter, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, Deque, Dict, Iterable, List, Optional, Tuple


def _parse_iso8601(ts: str) -> Optional[datetime]:
    try:
        # audit_log.jsonl is written as datetime.utcnow().isoformat() (no Z)
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _safe_json_loads(line: str) -> Optional[Dict[str, Any]]:
    try:
        obj = json.loads(line)
        if isinstance(obj, dict):
            return obj
        return None
    except Exception:
        return None


def _classify_severity(action: str, entry: Dict[str, Any]) -> str:
    # Rules are intentionally simple + explainable.
    safety_score = entry.get("safety_score")
    entities: List[str] = []

    if action == "redaction_event":
        entities = list(entry.get("entities_detected") or [])
    elif action == "chat_proxy_event":
        entities = list(entry.get("entities_hidden") or [])

    sensitive_entities = {"CREDIT_CARD", "US_SSN", "API_KEY", "AWS_KEY", "AWS_SECRET_KEY"}
    has_sensitive = any(e in sensitive_entities for e in entities)

    if isinstance(safety_score, (int, float)):
        if safety_score < 70:
            return "high"
        if safety_score < 90:
            return "medium"

    if has_sensitive:
        return "high"

    if action in {"audit_event", "redaction_event", "chat_proxy_event"}:
        return "low"

    return "info"


def _derive_message(action: str, entry: Dict[str, Any]) -> str:
    if action == "redaction_event":
        mode = entry.get("mode_used")
        count = entry.get("entity_count")
        entities = entry.get("entities_detected")
        if entities:
            uniq = sorted(set(entities))
            return f"Sanitized input ({mode}) - redacted {count} entities: {', '.join(uniq[:6])}{'…' if len(uniq) > 6 else ''}"
        return f"Sanitized input ({mode})"

    if action == "audit_event":
        s = entry.get("safety_score")
        u = entry.get("usability_score")
        return f"Audit completed - safety {s}/100, usability {u}/100"

    if action == "chat_proxy_event":
        mode = entry.get("mode")
        hidden = entry.get("entities_hidden")
        if hidden:
            uniq = sorted(set(hidden))
            return f"Chat forwarded ({mode}) - hidden: {', '.join(uniq[:6])}{'…' if len(uniq) > 6 else ''}"
        return f"Chat forwarded ({mode})"

    return action


@dataclass(frozen=True)
class AuditEvent:
    timestamp: str
    action: str
    severity: str
    entities: List[str]
    processing_time_ms: Optional[float]
    safety_score: Optional[float]
    usability_score: Optional[float]
    message: str


class AuditLogService:
    def __init__(self, log_path: str, recent_max: int = 5000):
        self._log_path = log_path
        self._lock = Lock()

        self._last_mtime: Optional[float] = None
        self._last_size: Optional[int] = None

        self._recent: Deque[Tuple[datetime, AuditEvent]] = deque(maxlen=recent_max)
        self._entity_counter: Counter[str] = Counter()
        self._processing_times: List[float] = []
        self._safety_scores: List[float] = []
        self._usability_scores: List[float] = []

        self._total_redactions: int = 0
        self._total_audits: int = 0
        self._total_chat_proxy: int = 0

        self._high_risk: int = 0
        self._medium_risk: int = 0
        self._low_risk: int = 0
        self._info: int = 0

    def _stat(self) -> Optional[os.stat_result]:
        try:
            return os.stat(self._log_path)
        except Exception:
            return None

    def _needs_refresh(self) -> bool:
        st = self._stat()
        if not st:
            return False
        if self._last_mtime is None or self._last_size is None:
            return True
        return st.st_mtime != self._last_mtime or st.st_size != self._last_size

    def _reset(self, st: os.stat_result) -> None:
        self._last_mtime = st.st_mtime
        self._last_size = st.st_size

        self._recent.clear()
        self._entity_counter = Counter()
        self._processing_times = []
        self._safety_scores = []
        self._usability_scores = []

        self._total_redactions = 0
        self._total_audits = 0
        self._total_chat_proxy = 0

        self._high_risk = 0
        self._medium_risk = 0
        self._low_risk = 0
        self._info = 0

    def _load_all(self) -> None:
        st = self._stat()
        if not st:
            return

        self._reset(st)

        if not os.path.exists(self._log_path):
            return

        with open(self._log_path, "r", encoding="utf-8", errors="replace") as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue

                entry = _safe_json_loads(line)
                if not entry:
                    continue

                ts = _parse_iso8601(str(entry.get("timestamp", "")))
                if not ts:
                    continue

                action = str(entry.get("action") or "")
                if not action:
                    continue

                entities: List[str] = []
                if action == "redaction_event":
                    entities = list(entry.get("entities_detected") or [])
                    self._total_redactions += 1
                    pt = entry.get("processing_time_ms")
                    if isinstance(pt, (int, float)):
                        self._processing_times.append(float(pt))

                elif action == "audit_event":
                    self._total_audits += 1
                    ss = entry.get("safety_score")
                    us = entry.get("usability_score")
                    if isinstance(ss, (int, float)):
                        self._safety_scores.append(float(ss))
                    if isinstance(us, (int, float)):
                        self._usability_scores.append(float(us))

                elif action == "chat_proxy_event":
                    entities = list(entry.get("entities_hidden") or [])
                    self._total_chat_proxy += 1

                for e in entities:
                    if isinstance(e, str) and e:
                        self._entity_counter[e] += 1

                severity = _classify_severity(action, entry)
                if severity == "high":
                    self._high_risk += 1
                elif severity == "medium":
                    self._medium_risk += 1
                elif severity == "low":
                    self._low_risk += 1
                else:
                    self._info += 1

                event = AuditEvent(
                    timestamp=ts.isoformat(),
                    action=action,
                    severity=severity,
                    entities=entities,
                    processing_time_ms=(float(entry["processing_time_ms"]) if isinstance(entry.get("processing_time_ms"), (int, float)) else None),
                    safety_score=(float(entry["safety_score"]) if isinstance(entry.get("safety_score"), (int, float)) else None),
                    usability_score=(float(entry["usability_score"]) if isinstance(entry.get("usability_score"), (int, float)) else None),
                    message=_derive_message(action, entry),
                )
                self._recent.append((ts, event))

    def refresh_if_needed(self) -> None:
        with self._lock:
            if self._needs_refresh():
                self._load_all()

    def get_recent_events(self, limit: int = 100) -> List[Dict[str, Any]]:
        self.refresh_if_needed()
        with self._lock:
            items = list(self._recent)[-limit:]
        items.sort(key=lambda x: x[0], reverse=True)
        return [e.__dict__ for _, e in items]

    def get_pii_distribution(self) -> Dict[str, int]:
        self.refresh_if_needed()
        with self._lock:
            # Return a plain dict for FastAPI JSON serialization
            return dict(self._entity_counter)

    def get_timeline(self, hours: int = 24) -> List[Dict[str, Any]]:
        self.refresh_if_needed()

        now = datetime.now(timezone.utc)
        start = now - timedelta(hours=hours)

        buckets: Dict[str, Dict[str, Any]] = {}
        for i in range(hours):
            t = start + timedelta(hours=i)
            key = t.replace(minute=0, second=0, microsecond=0).isoformat()
            buckets[key] = {"time": key, "detected": 0, "redacted": 0}

        with self._lock:
            recent = list(self._recent)

        for ts, ev in recent:
            if ts < start or ts > now:
                continue
            key = ts.replace(minute=0, second=0, microsecond=0).isoformat()
            if key not in buckets:
                continue

            if ev.action == "redaction_event":
                # Approximate detected/redacted counts via entity list length
                cnt = len(ev.entities)
                buckets[key]["detected"] += cnt
                buckets[key]["redacted"] += cnt

        return [buckets[k] for k in sorted(buckets.keys())]

    def get_enhanced_stats(self) -> Dict[str, Any]:
        self.refresh_if_needed()
        with self._lock:
            avg_pt = round(sum(self._processing_times) / len(self._processing_times), 2) if self._processing_times else 0.0
            avg_safety = round(sum(self._safety_scores) / len(self._safety_scores), 2) if self._safety_scores else 0.0
            avg_usability = round(sum(self._usability_scores) / len(self._usability_scores), 2) if self._usability_scores else 0.0

            return {
                "total_redactions": self._total_redactions,
                "total_audits": self._total_audits,
                "total_chat_proxy": self._total_chat_proxy,
                "avg_processing_time_ms": avg_pt,
                "avg_safety_score": avg_safety,
                "avg_usability_score": avg_usability,
                "high_risk_count": self._high_risk,
                "medium_risk_count": self._medium_risk,
                "low_risk_count": self._low_risk,
                "info_count": self._info,
                "entity_breakdown": dict(self._entity_counter),
            }
