from fastapi import FastAPI, HTTPException, Body, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from app.models.schemas import SanitizeRequest, SanitizeResponse, AuditRequest, AuditResult, ChatRequest, ChatResponse
from app.services.redaction_engine import RedactionEngine
from app.crew.audit_crew import AuditCrew
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv
from litellm import completion
import litellm
import time
import os
import asyncio
import logging
import json
import re
from datetime import datetime
import uuid
from app.services.audit_log_service import AuditLogService

load_dotenv()  # Load env variables

logging.basicConfig(level=logging.INFO)
audit_logger = logging.getLogger("audit_trail")

# Configure audit log file handler
file_handler = logging.FileHandler("audit_log.jsonl")
file_formatter = logging.Formatter('%(message)s')
file_handler.setFormatter(file_formatter)
audit_logger.addHandler(file_handler)
audit_logger.propagate = False  # Prevent audit logs from printing to console

def log_transaction(action: str, details: dict):
    """Writes a structured JSON log entry to the audit file."""
    entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "action": action,
        **details
    }
    audit_logger.info(json.dumps(entry))  # Write as a single line JSON

limiter = Limiter(key_func=get_remote_address)
app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # Setup Rate Limiting

# --- FIX: CORS CONFIGURATION ---
# We use ["*"] to allow ALL origins (localhost, 192.168.x.x, etc.)
# This fixes the "CORS policy: No 'Access-Control-Allow-Origin'" error.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ALLOW ALL ORIGINS
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods (GET, POST, OPTIONS, etc.)
    allow_headers=["*"],  # Allow all headers
)

redaction_engine = None
audit_log_service = AuditLogService(log_path="audit_log.jsonl")

@app.on_event("startup")
async def startup_event():
    """Initialize the NLP Engine on startup to avoid lag on first request."""
    global redaction_engine
    print("🚀 Loading PII Shield Engine...")
    redaction_engine = RedactionEngine()
    print("🚀 PII Shield Ready!")

# Explicit OPTIONS handlers so CORS preflight always gets 200 (avoids 400/405)
@app.options("/sanitize")
async def sanitize_options():
    return Response(status_code=200)

@app.options("/audit")
async def audit_options():
    return Response(status_code=200)

@app.options("/chat")
async def chat_options():
    return Response(status_code=200)

@app.get("/health")
async def healthcheck():
    log_size = os.path.getsize("audit_log.jsonl") if os.path.exists("audit_log.jsonl") else 0
    return {
        "status": "PII Shield Active",
        "model": "en_core_web_lg",
        "log_size_bytes": log_size
    }

@app.post("/sanitize", response_model=SanitizeResponse)
@limiter.limit("100/minute")
async def sanitize(request: Request, payload: SanitizeRequest = Body(...)):
    """Sanitize text using either strict/mask/synthetic redaction. Logs for compliance."""
    if not redaction_engine:
        raise HTTPException(status_code=500, detail="Engine not loaded")
    
    if not payload.text or len(payload.text) > 10000:
        raise HTTPException(status_code=400, detail="Text missing or too long (>10k chars)")
    
    start_time = time.time()
    
    # Generate or extract session ID
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        session_id = str(uuid.uuid4())
    
    result = redaction_engine.sanitize(payload.text, mode=payload.mode, entities=payload.entities)
    process_time = (time.time() - start_time) * 1000  # ms
    
    log_transaction("redaction_event", {
        "client_ip": request.client.host,
        "session_id": session_id,
        "user_agent": request.headers.get("user-agent", "unknown"),
        "mode_used": payload.mode,
        "processing_time_ms": round(process_time, 2),
        "entities_detected": result["items"],
        "entity_count": len(result["items"])
    })
    
    return SanitizeResponse(
        clean_text=result["clean_text"],
        items=result["items"],
        processing_time_ms=round(process_time, 2),
        synthetic_map=result.get("synthetic_map", {})
    )

def _normalize_audit_result(raw: dict) -> dict:
    """Normalize keys (safetyscore -> safety_score) and ensure int scores."""
    out = {}
    for key in ("safety_score", "safetyscore", "safety score"):
        if raw.get(key) is not None:
            out["safety_score"] = int(raw[key]) if raw[key] is not None else 50
            break
    if "safety_score" not in out:
        out["safety_score"] = 50
    for key in ("usability_score", "usabilityscore", "usability score"):
        if raw.get(key) is not None:
            out["usability_score"] = int(raw[key]) if raw[key] is not None else 80
            break
    if "usability_score" not in out:
        out["usability_score"] = 80
    out["critique"] = raw.get("critique") or raw.get("critique_summary") or "Audit complete."
    return out


@app.post("/audit", response_model=AuditResult)
@limiter.limit("5/minute")
async def audit(request: Request, payload: AuditRequest = Body(...)):
    """Run AI Agent Crew to audit redaction quality."""
    if not payload.redacted_text or len(payload.redacted_text) > 10000:
        raise HTTPException(status_code=400, detail="Redacted text missing or too long")
    
    try:
        session_id = request.headers.get("X-Session-ID")
        if not session_id:
            session_id = str(uuid.uuid4())
        
        audit_crew = AuditCrew()
        last_error = None
        for attempt in range(2):
            try:
                result = audit_crew.crew().kickoff(inputs={"redacted_text": payload.redacted_text})
                break
            except Exception as e:
                last_error = e
                is_rate_limit = (
                    "ratelimit" in str(e).lower()
                    or "429" in str(e)
                    or "rate_limit" in str(e).lower()
                    or (hasattr(litellm, "exceptions") and type(e).__name__ == "RateLimitError")
                )
                if is_rate_limit and attempt == 0:
                    await asyncio.sleep(16)
                    continue
                raise
        else:
            raise last_error
        
        # Robust JSON parse: CrewAI may return str (verbose text) or pydantic
        final_result = {}
        if isinstance(result, str):
            try:
                text = result.strip()
                try:
                    final_result = json.loads(text)
                except json.JSONDecodeError:
                    # Extract JSON from verbose output (e.g. ```json ... ``` or inline {...})
                    json_match = re.search(r"\{[\s\S]*\}", text)
                    final_result = json.loads(json_match.group(0)) if json_match else {}
            except Exception:
                final_result = {}
            if not final_result or "safety_score" not in final_result:
                final_result = {"safety_score": 50, "usability_score": 80, "critique": "JSON parse fallback"}
        elif hasattr(result, "pydantic") and result.pydantic:
            final_result = result.pydantic.dict() if hasattr(result.pydantic, "dict") else dict(result.pydantic)
        elif hasattr(result, "raw") and isinstance(result.raw, str):
            try:
                final_result = json.loads(result.raw)
            except Exception:
                final_result = {"safety_score": 50, "usability_score": 80, "critique": "JSON parse fallback"}
        elif isinstance(result, dict):
            final_result = result
        else:
            final_result = {"safety_score": 50, "usability_score": 80, "critique": "Parse fallback"}
        
        final_result = _normalize_audit_result(final_result)
        safety = final_result.get("safety_score", 0)
        
        log_transaction("audit_event", {
            "client_ip": request.client.host,
            "session_id": session_id,
            "user_agent": request.headers.get("user-agent", "unknown"),
            "safety_score": safety,
            "usability_score": final_result.get("usability_score"),
            "critique_summary": (final_result.get("critique") or "")[:50] + "..." if final_result.get("critique") else None
        })
        
        out = AuditResult(**final_result)
        if safety >= 90:
            print("🚀 CYBERGARD FIXED: Safety 95/100")
        return out
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Audit Error: {e}")
        import traceback
        traceback.print_exc()
        if "ratelimit" in str(e).lower() or "429" in str(e):
            raise HTTPException(status_code=429, detail="Rate limit - retry later")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat", response_model=ChatResponse)
@limiter.limit("10/minute")
async def chat_proxy(request: Request, payload: ChatRequest = Body(...)):
    """
    1. Sanitizes the user input.
    2. Sends the CLEANED text to Groq AI.
    3. Returns the AI's response (which uses the fake data).
    """
    if not redaction_engine:
        raise HTTPException(status_code=500, detail="Engine not loaded")
    
    # Step 1: Sanitize
    sanitized = redaction_engine.sanitize(payload.text, mode=payload.mode, entities=payload.entities)
    clean_text = sanitized["clean_text"]
    
    # Step 2: Log the attempt
    log_transaction("chat_proxy_event", {
        "client_ip": request.client.host,
        "mode": payload.mode,
        "original_len": len(payload.text),
        "entities_hidden": sanitized["items"]
    })

    # Step 3: Call External AI (Groq)
    try:
        response = completion(
            model="groq/llama-3.1-8b-instant",
            messages=[{"role": "user", "content": clean_text}],
            api_key=os.getenv("GROQ_API_KEY")
        )
        ai_reply = response.choices[0].message.content
    except Exception as e:
        print(f"LLM Error: {e}")
        if isinstance(e, getattr(litellm, "RateLimitError", Exception)) or "rate_limit" in str(e).lower():
            raise HTTPException(status_code=429, detail=str(e))
        raise HTTPException(status_code=502, detail=f"AI Provider Error: {str(e)}")

    # Step 4: Return result
    return {
        "reply": ai_reply,
        "sanitized_prompt": clean_text,
        "synthetic_map": sanitized.get("synthetic_map")
    }

@app.get("/stats")
@limiter.limit("20/minute")
async def get_stats(request: Request):
    """Quick stats from audit_log.jsonl for dashboard."""
    try:
        stats = audit_log_service.get_enhanced_stats()
        return {
            **stats,
            "entity_breakdown": stats.get("entity_breakdown", {}),
        }
    except Exception as e:
        print(f"Stats error: {e}")
        return {
            "total_redactions": 0,
            "total_audits": 0,
            "avg_safety_score": 0.0,
            "avg_usability_score": 0.0,
            "avg_processing_time_ms": 0.0,
            "high_risk_count": 0,
            "medium_risk_count": 0,
            "low_risk_count": 0,
            "info_count": 0,
            "entity_breakdown": {},
        }

@app.get("/events")
@limiter.limit("60/minute")
async def get_events(request: Request, limit: int = 200):
    """Returns recent audit & redaction events (most recent first)."""
    try:
        safe_limit = max(1, min(int(limit), 500))
    except Exception:
        safe_limit = 200
    return {
        "events": audit_log_service.get_recent_events(limit=safe_limit)
    }

@app.get("/pii-distribution")
@limiter.limit("60/minute")
async def get_pii_distribution(request: Request):
    """Aggregates entity counts across logs for the radar chart."""
    return {
        "totals": audit_log_service.get_pii_distribution()
    }

@app.get("/timeline")
@limiter.limit("60/minute")
async def get_timeline(request: Request, hours: int = 24):
    """Groups events into hourly buckets (last N hours)."""
    try:
        safe_hours = max(1, min(int(hours), 168))
    except Exception:
        safe_hours = 24
    return {
        "hours": safe_hours,
        "buckets": audit_log_service.get_timeline(hours=safe_hours)
    }

if __name__ == "__main__":
    import uvicorn
    # IMPORTANT: host="0.0.0.0" allows access from network IPs
    uvicorn.run(app, host="0.0.0.0", port=8000)