"use client";

import React from "react"

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldAlert,
  ShieldCheck,
  Scan,
  AlertTriangle,
  Trash2,
  Shield,
  CheckCircle,
  Eye,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StepIndicator } from "@/components/step-indicator";
import { useDemoMode } from "@/contexts/DemoModeContext";
import { sanitizeText, auditText, chatProxy, type SanitizeMode, type AuditResult } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useGovernance } from "@/contexts/GovernanceContext";

type AuditStatus = "idle" | "running" | "passed" | "failed" | "rate_limited";

// PII Detection patterns and types
interface PIIMatch {
  type: string;
  original: string;
  replacement: string;
  start: number;
  end: number;
}

// Fallback regex patterns for demo mode
const PII_PATTERNS: { type: string; regex: RegExp; replacement: string }[] = [
  {
    type: "CREDIT_CARD",
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    replacement: "[REDACTED_CC]",
  },
  {
    type: "SSN",
    regex: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
    replacement: "[REDACTED_SSN]",
  },
  {
    type: "EMAIL",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    type: "PHONE",
    regex: /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[REDACTED_PHONE]",
  },
  {
    type: "AWS_KEY",
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  {
    type: "API_KEY",
    regex: /\b(sk-[a-zA-Z0-9]{32,})\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    type: "IP_ADDRESS",
    regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    replacement: "[REDACTED_IP]",
  },
];

// Fallback PII detection for demo mode
function detectPII(text: string): PIIMatch[] {
  const matches: PIIMatch[] = [];
  for (const pattern of PII_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        type: pattern.type,
        original: match[0],
        replacement: pattern.replacement,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

// Convert backend response to PIIMatch format for highlighting
function convertBackendResponseToMatches(
  originalText: string,
  cleanText: string,
  items: string[],
  syntheticMap?: Record<string, string>
): PIIMatch[] {
  const matches: PIIMatch[] = [];

  const normalizeEntityType = (entityType: string): string => {
    return entityType
      .replace("EMAIL_ADDRESS", "EMAIL")
      .replace("PHONE_NUMBER", "PHONE")
      .replace("US_SSN", "SSN")
      .replace("IP_ADDRESS", "IP")
      .replace("_ADDRESS", "")
      .replace("_NUMBER", "")
      .replace("US_", "");
  };

  const inferEntityType = (original: string): string => {
    if (original.includes("@")) return "EMAIL";
    if (original.match(/^\d{3}-?\d{2}-?\d{4}$/)) return "SSN";
    if (original.match(/^\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}$/)) return "CREDIT_CARD";
    if (original.match(/^\+?[\d\s\-\(\)]{10,}$/)) return "PHONE";
    if (original.match(/^(sk-|ghp_|AKIA)/)) return "API_KEY";
    if (original.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) return "IP";
    return "PERSON";
  };

  if (syntheticMap && Object.keys(syntheticMap).length > 0) {
    const processedPositions = new Set<string>();

    for (const [original, replacement] of Object.entries(syntheticMap)) {
      let searchIndex = 0;

      while (searchIndex < cleanText.length) {
        const index = cleanText.indexOf(replacement, searchIndex);
        if (index === -1) break;

        const posKey = `${index}-${index + replacement.length}`;
        if (processedPositions.has(posKey)) {
          searchIndex = index + 1;
          continue;
        }

        let entityType = "PII";

        if (replacement.match(/^<[A-Z_]+>$/)) {
          entityType = normalizeEntityType(replacement.slice(1, -1));
        } else if (replacement.match(/^[A-Z_]+ \d+$/)) {
          const rawType = replacement.split(" ")[0];
          entityType = normalizeEntityType(rawType);
        } else {
          entityType = inferEntityType(original);
        }

        matches.push({
          type: entityType,
          original: original,
          replacement: replacement,
          start: index,
          end: index + replacement.length,
        });

        processedPositions.add(posKey);
        searchIndex = index + replacement.length;
      }
    }
  } else {
    const tagPattern = /<([A-Z_]+)>/g;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(cleanText)) !== null) {
      const rawEntityType = match[1];
      const entityType = normalizeEntityType(rawEntityType);

      matches.push({
        type: entityType,
        original: `[${rawEntityType}]`,
        replacement: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  const uniqueMatches = matches
    .sort((a, b) => a.start - b.start)
    .filter((match, index, array) => {
      if (index === 0) return true;
      const prev = array[index - 1];
      return match.start !== prev.start || match.end !== prev.end;
    });

  return uniqueMatches;
}

function RedactedText({
  text,
  matches,
  isScanning,
  isDemoMode = false,
}: {
  text: string;
  matches: PIIMatch[];
  isScanning: boolean;
  isDemoMode?: boolean;
}) {
  if (!text) {
    return (
      <span className="text-muted-foreground/40 font-mono text-sm italic">
        Sanitized output will appear here...
      </span>
    );
  }

  if (matches.length === 0) {
    return <span className="font-mono text-sm text-foreground">{text}</span>;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  matches.forEach((m, i) => {
    if (m.start > lastIndex) {
      parts.push(
        <span key={`text-${i}`} className="font-mono text-sm text-foreground">
          {text.slice(lastIndex, m.start)}
        </span>
      );
    }
    parts.push(
      <motion.span
        key={`redacted-${i}`}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: i * 0.1, duration: 0.3 }}
        className="inline-flex items-center gap-1 rounded-sm bg-destructive/20 border border-destructive/40 px-1.5 py-0.5 font-mono text-xs text-destructive glow-rose"
      >
        <ShieldAlert className="h-3 w-3" />
        {m.replacement}
      </motion.span>
    );
    lastIndex = m.end;
  });

  if (lastIndex < text.length) {
    parts.push(
      <span key="text-end" className="font-mono text-sm text-foreground">
        {text.slice(lastIndex)}
      </span>
    );
  }

  return (
    <div className="relative">
      {isScanning && (
        <motion.div
          initial={{ top: 0 }}
          animate={{ top: "100%" }}
          transition={{ duration: 1.2, ease: "easeInOut" }}
          className="pointer-events-none absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"
          style={{ boxShadow: "0 0 12px hsl(160 84% 39% / 0.6)" }}
        />
      )}
      <div className="leading-relaxed">{parts}</div>
    </div>
  );
}

const SAMPLE_PROMPTS = [
  "My name is John Doe, email: john.doe@acme.com and my SSN is 123-45-6789. Please process my payment with card 4532-1234-5678-9012.",
  "Deploy to server 192.168.1.100 using API key sk-abcdefghijklmnopqrstuvwxyz123456 and AWS key AKIAIOSFODNN7EXAMPLE.",
  "Contact Sarah at (555) 867-5309 or sarah.connor@skynet.io for the medical records.",
];

interface HistoryEntry {
  id: number;
  input: string;
  matches: PIIMatch[];
  timestamp: Date;
}

export function ShieldChat() {
  const { isDemoMode } = useDemoMode();
  const { config } = useGovernance();
  const [input, setInput] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [currentMatches, setCurrentMatches] = useState<PIIMatch[]>([]);
  const [sanitizedText, setSanitizedText] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeStep, setActiveStep] = useState("sanitize");
  const [apiError, setApiError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditStatus, setAuditStatus] = useState<AuditStatus>("idle");
  const [processingTime, setProcessingTime] = useState<number | null>(null);
  const [sanitizeMode, setSanitizeMode] = useState<SanitizeMode>("synthetic");
  const [aiResponse, setAiResponse] = useState<string>("");
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const steps = [
    { id: "sanitize", label: "Sanitize", icon: Shield },
    { id: "verify", label: "Verify", icon: CheckCircle },
    { id: "forward", label: "Forward", icon: Send },
  ];

  const handleSanitize = useCallback(async () => {
    if (!input.trim()) return;
    setActiveStep("sanitize");
    setIsScanning(true);
    setApiError(null);
    setAuditResult(null);
    setAuditStatus("idle");
    setProcessingTime(null);

    try {
      // 1. Sanitize (decoupled from audit)
      const response = await sanitizeText(input, sanitizeMode, config.enabledEntities);

      setSanitizedText(response.clean_text);
      setProcessingTime(response.processing_time_ms);

      const matches = convertBackendResponseToMatches(
        input,
        response.clean_text,
        response.items,
        response.synthetic_map
      );
      setCurrentMatches(matches);
      setIsScanning(false);
      setActiveStep("verify");

      setHistory((prev) => [
        {
          id: Date.now(),
          input,
          matches,
          timestamp: new Date(),
        },
        ...prev,
      ]);

      // 2. Get AI Response (non-blocking, separate from audit)
      setIsLoadingAI(true);
      setAiError(null);
      chatProxy(input, sanitizeMode)
        .then((chatResponse) => {
          setAiResponse(chatResponse.reply);
          setIsLoadingAI(false);
        })
        .catch((aiErr) => {
          console.error("AI Chat error:", aiErr);
          setAiError(aiErr instanceof Error ? aiErr.message : "AI unavailable");
          setIsLoadingAI(false);
        });

      // 2. Audit is best-effort, non-blocking; never clears sanitize state
      setAuditStatus("running");
      try {
        const audit = await auditText(response.clean_text);
        setAuditResult(audit);
        setAuditStatus("passed");
        // Do not auto-clear: input and output persist until user clicks Clear
      } catch (auditError) {
        const msg = auditError instanceof Error ? auditError.message : String(auditError);
        const isRateLimited =
          msg.includes("429") ||
          msg.includes("rate") ||
          msg.includes("limit") ||
          msg.includes("500");
        setAuditStatus(isRateLimited ? "rate_limited" : "failed");
        setAuditResult(null);
        // Do NOT clear input, sanitizedText, or matches; do NOT call handleForward
      }
    } catch (error) {
      console.error("Sanitize API error:", error);
      setApiError(error instanceof Error ? error.message : "Backend unavailable - using demo mode");
      setAuditStatus("idle");

      // Fallback to demo mode: show regex highlights only; no audit (no clean_text to send)
      setTimeout(() => {
        const matches = detectPII(input);
        setCurrentMatches(matches);
        setSanitizedText(input);
        setIsScanning(false);
        setActiveStep("verify");
        setHistory((prev) => [
          { id: Date.now(), input, matches, timestamp: new Date() },
          ...prev,
        ]);
        setAuditStatus("idle");
      }, 1200);
    }
  }, [input, sanitizeMode, config.enabledEntities]);

  const handleSampleClick = (sample: string) => {
    setInput(sample);
    setSanitizedText("");
    setCurrentMatches([]);
    setActiveStep("sanitize");
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    if (value.trim()) {
      setActiveStep("sanitize");
    } else {
      setActiveStep("sanitize");
      setSanitizedText("");
      setCurrentMatches([]);
    }
  };

  const handleForward = () => {
    setActiveStep("forward");
    setAuditStatus("idle");
    setTimeout(() => {
      setInput("");
      setSanitizedText("");
      setCurrentMatches([]);
      setAuditResult(null);
      setApiError(null);
      setActiveStep("sanitize");
    }, 1000);
  };

  // Demo mode auto-fill
  React.useEffect(() => {
    if (isDemoMode && !input) {
      const demoText = "My name is John Doe, email: john.doe@acme.com and my SSN is 123-45-6789. Please process my payment with card 4532-1234-5678-9012.";
      setInput(demoText);
      setActiveStep("sanitize");
      
      // Auto-trigger sanitize after 1 second
      setTimeout(() => {
        handleSanitize();
      }, 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoMode]);

  // Update active step based on state
  React.useEffect(() => {
    if (currentMatches.length > 0 && !isScanning) {
      setActiveStep("verify");
    } else if (isScanning) {
      setActiveStep("sanitize");
    } else {
      setActiveStep("sanitize");
    }
  }, [input, currentMatches, isScanning]);

  const handleClear = () => {
    setInput("");
    setSanitizedText("");
    setCurrentMatches([]);
    setAuditResult(null);
    setAuditStatus("idle");
    setAiResponse("");
    setAiError(null);
  };

  const threatCount = currentMatches.length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Privacy Shield</h2>
          <p className="text-sm text-muted-foreground">
            Real-time PII detection and sanitization engine
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[10px] uppercase tracking-wider",
              threatCount > 0
                ? "border-destructive/40 text-destructive"
                : "border-primary/40 text-primary"
            )}
          >
            {threatCount > 0 ? `${threatCount} PII DETECTED` : "CLEAN SIGNAL"}
          </Badge>
        </div>
      </div>

      {/* API Error Banner */}
      {apiError && (
        <Alert className="border-yellow-500/50 bg-yellow-500/10">
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
          <AlertDescription className="text-[11px] font-mono text-yellow-500">
            {apiError}
          </AlertDescription>
        </Alert>
      )}

      {/* Step Indicator: gray out Verify/Forward when audit failed or rate-limited */}
      <StepIndicator
        steps={steps}
        activeStep={activeStep}
        unavailableSteps={
          auditStatus === "failed" || auditStatus === "rate_limited"
            ? ["verify", "forward"]
            : []
        }
      />

      {/* Mode Selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Mode:
        </span>
        <div className="flex gap-1">
          {(["strict", "synthetic", "mask"] as SanitizeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSanitizeMode(mode)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[10px] font-mono uppercase transition-colors",
                sanitizeMode === mode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Sample Prompts */}
      <div className="flex flex-wrap gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground self-center mr-1">
          Test vectors:
        </span>
        {SAMPLE_PROMPTS.map((sample, i) => (
          <button
            key={i}
            type="button"
            onClick={() => handleSampleClick(sample)}
            className="rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors truncate max-w-[200px]"
          >
            Vector #{i + 1}
          </button>
        ))}
      </div>

      {/* Split Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Untrusted Input */}
        <div className="flex flex-col rounded-lg border border-destructive/20 bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-destructive/20 bg-destructive/5 px-4 py-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-destructive">
                USER_PROMPT_UNTRUSTED
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-destructive/60" />
              <span className="text-[10px] font-mono text-destructive/60">RAW</span>
            </div>
          </div>
          <div className="relative flex-1 p-4">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                handleInputChange(e.target.value);
                setSanitizedText("");
                setCurrentMatches([]);
              }}
              placeholder="Paste untrusted prompt content here... (includes PII, API keys, credentials)"
              className="h-48 w-full resize-none bg-transparent font-mono text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-2">
            <span className="text-[10px] font-mono text-muted-foreground">
              {input.length} chars
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="h-7 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="mr-1 h-3 w-3" />
                CLEAR
              </Button>
              <Button
                size="sm"
                onClick={handleSanitize}
                disabled={!input.trim() || isScanning}
                className="h-7 gap-1.5 bg-primary px-3 text-[10px] font-mono uppercase tracking-wider text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isScanning ? (
                  <>
                    <Scan className="h-3 w-3 animate-spin" />
                    SCANNING
                  </>
                ) : (
                  <>
                    <Send className="h-3 w-3" />
                    SANITIZE & FORWARD
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Right: Sanitized Output */}
        <div className="flex flex-col rounded-lg border border-primary/20 bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-primary">
                SANITIZED_OUTPUT
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-mono text-primary/60">PROTECTED</span>
            </div>
          </div>
          <div className="relative flex-1 p-4 min-h-[192px]">
            <AnimatePresence mode="wait">
              {isScanning && (
                <motion.div
                  key="scanning"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative h-12 w-12">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary"
                      />
                      <Eye className="absolute inset-0 m-auto h-5 w-5 text-primary" />
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-primary animate-pulse">
                      Analyzing threat vectors...
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {!isScanning && (
              <RedactedText
                text={sanitizedText}
                matches={currentMatches}
                isScanning={false}
                isDemoMode={isDemoMode}
              />
            )}
          </div>
          {/* Threat Summary & Audit Results */}
          {currentMatches.length > 0 && !isScanning && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="border-t border-primary/20 bg-primary/5 px-4 py-2 space-y-2"
            >
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const typeCounts = new Map<string, number>();
                  currentMatches.forEach((m) => {
                    typeCounts.set(m.type, (typeCounts.get(m.type) || 0) + 1);
                  });

                  return Array.from(typeCounts.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([type, count]) => (
                      <Badge
                        key={type}
                        variant="outline"
                        className="border-destructive/30 bg-destructive/10 text-[10px] font-mono text-destructive"
                      >
                        {type} x{count}
                      </Badge>
                    ));
                })()}
              </div>
              
              {/* Processing Time */}
              {processingTime !== null && (
                <div className="text-[10px] font-mono text-muted-foreground">
                  Processing: {processingTime.toFixed(2)}ms
                </div>
              )}
              
              {/* Audit status: running / passed / temporarily unavailable */}
              {auditStatus === "running" && (
                <div className="text-[10px] font-mono text-primary animate-pulse">
                  Running security audit...
                </div>
              )}
              {(auditStatus === "failed" || auditStatus === "rate_limited") && (
                <Badge
                  variant="outline"
                  className="border-yellow-500/50 bg-yellow-500/10 text-[10px] font-mono text-yellow-500"
                >
                  Audit temporarily unavailable
                </Badge>
              )}
              {auditResult && (
                <div className={cn(
                  "rounded-md border p-2 text-[10px] font-mono",
                  auditResult.safety_score > 90
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : auditResult.safety_score > 70
                    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-500"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                )}>
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck className="h-3 w-3" />
                    <span>Safety: {auditResult.safety_score}/100</span>
                    <span>Usability: {auditResult.usability_score}/100</span>
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-1">
                    {auditResult.critique}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {/* AI Response Panel */}
      {(aiResponse || isLoadingAI || aiError) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-primary/30 bg-card overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-2">
            <div className="flex items-center gap-2">
              <Send className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-primary">
                EXTERNAL_AI_RESPONSE
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isLoadingAI ? "bg-yellow-500 animate-pulse" : "bg-primary"
                )}
              />
              <span className="text-[10px] font-mono text-primary/60">
                {isLoadingAI ? "PROCESSING" : "COMPLETE"}
              </span>
            </div>
          </div>

          <div className="p-4 min-h-[120px]">
            {isLoadingAI && (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative h-10 w-10">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary"
                    />
                    <Send className="absolute inset-0 m-auto h-4 w-4 text-primary" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-primary animate-pulse">
                    AI processing sanitized data...
                  </span>
                </div>
              </div>
            )}

            {aiError && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <AlertDescription className="text-[11px] font-mono text-yellow-500">
                  AI Response Error: {aiError}
                </AlertDescription>
              </Alert>
            )}

            {aiResponse && !isLoadingAI && (
              <div className="space-y-3">
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-primary/60 mb-2">
                    AI Received (Sanitized):
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">{sanitizedText}</div>
                </div>

                <div className="rounded-md border border-primary/30 bg-card p-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-primary mb-2">
                    AI Response:
                  </div>
                  <div className="font-mono text-sm text-foreground leading-relaxed">{aiResponse}</div>
                </div>

                <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                  <ShieldCheck className="h-3 w-3 text-primary" />
                  <span>No real PII was exposed to the AI - only synthetic data was shared</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Agent Status Orbs */}
      <div className="flex flex-wrap items-center gap-3">
        {[
          { name: "Sanitize", status: "Ready", color: "primary" },
          { name: "Verify", status: "Monitoring", color: "primary" },
          { name: "Forward", status: "Queued", color: "primary" },
        ].map((agent) => (
          <div
            key={agent.name}
            className="flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5"
          >
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-mono text-muted-foreground">
              Agent: <span className="text-foreground">{agent.name}</span>
            </span>
            <span className="text-[10px] font-mono text-primary">{agent.status}</span>
          </div>
        ))}
      </div>

      {/* Scan History */}
      {history.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border bg-secondary/30 px-4 py-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Scan History ({history.length})
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto scrollbar-cyber divide-y divide-border">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-center gap-4 px-4 py-2.5">
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  {entry.timestamp.toLocaleTimeString()}
                </span>
                <span className="text-xs font-mono text-foreground truncate flex-1">
                  {entry.input.slice(0, 60)}...
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 text-[10px] font-mono",
                    entry.matches.length > 0
                      ? "border-destructive/30 text-destructive"
                      : "border-primary/30 text-primary"
                  )}
                >
                  {entry.matches.length} threats
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
