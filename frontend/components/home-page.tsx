"use client";

import React from "react"

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  Radar,
  Settings,
  Lock,
  ArrowRight,
  Activity,
  ShieldCheck,
  Zap,
  Eye,
  ChevronRight,
  Bot,
  Fingerprint,
  AlertTriangle,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// Animated counter hook
function useCounter(target: number, duration: number = 2000) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let start = 0;
    const increment = target / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return count;
}

// Shield logo animation component
function ShieldOrb() {
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer orbit ring */}
      <div className="absolute h-64 w-64 rounded-full border border-primary/10 animate-orbit">
        <div className="absolute -top-1.5 left-1/2 h-3 w-3 rounded-full bg-primary/40" />
      </div>
      {/* Middle orbit ring */}
      <div className="absolute h-48 w-48 rounded-full border border-primary/20 animate-orbit-reverse">
        <div className="absolute -bottom-1 right-4 h-2 w-2 rounded-full bg-neon-cyan/50" />
      </div>
      {/* Inner orbit ring */}
      <div className="absolute h-32 w-32 rounded-full border border-primary/15 animate-orbit" style={{ animationDuration: "12s" }} />
      {/* Core glow */}
      <div className="absolute h-24 w-24 rounded-full bg-primary/5 blur-xl" />
      <div className="absolute h-16 w-16 rounded-full bg-primary/10 blur-md" />
      {/* Shield icon center */}
      <motion.div
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 glow-emerald"
      >
        <Shield className="h-9 w-9 text-primary" />
      </motion.div>
    </div>
  );
}

// Live stat ticker
function StatTicker({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  const count = useCounter(value, 2500);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-2xl font-semibold text-foreground tabular-nums md:text-3xl">
        {count.toLocaleString()}
        {suffix}
      </span>
      <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

// Feature card
function FeatureCard({
  icon: Icon,
  title,
  description,
  href,
  color,
  tags,
  index,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
  color: "emerald" | "cyan" | "amber";
  tags: string[];
  index: number;
}) {
  const colorMap = {
    emerald: {
      border: "border-primary/15 hover:border-primary/40",
      iconBg: "bg-primary/10 text-primary",
      glow: "group-hover:glow-emerald",
      tagColor: "border-primary/20 text-primary/80",
      arrowBg: "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground",
    },
    cyan: {
      border: "border-neon-cyan/15 hover:border-neon-cyan/40",
      iconBg: "bg-neon-cyan/10 text-neon-cyan",
      glow: "group-hover:glow-cyan",
      tagColor: "border-neon-cyan/20 text-neon-cyan/80",
      arrowBg: "bg-neon-cyan/10 text-neon-cyan group-hover:bg-neon-cyan group-hover:text-background",
    },
    amber: {
      border: "border-neon-amber/15 hover:border-neon-amber/40",
      iconBg: "bg-neon-amber/10 text-neon-amber",
      glow: "",
      tagColor: "border-neon-amber/20 text-neon-amber/80",
      arrowBg: "bg-neon-amber/10 text-neon-amber group-hover:bg-neon-amber group-hover:text-background",
    },
  };

  const c = colorMap[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 + index * 0.15, duration: 0.5, ease: "easeOut" }}
    >
      <Link
        href={href}
        className={cn(
          "group relative flex flex-col gap-5 rounded-xl border bg-card p-6 transition-all duration-300",
          c.border,
          c.glow
        )}
      >
        {/* Icon and arrow */}
        <div className="flex items-start justify-between">
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-lg", c.iconBg)}>
            <Icon className="h-5 w-5" />
          </div>
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300",
              c.arrowBg
            )}
          >
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                c.tagColor
              )}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Bottom action */}
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground transition-colors group-hover:text-foreground">
          <span>Enter Module</span>
          <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Link>
    </motion.div>
  );
}

// Capability row
function CapabilityItem({
  icon: Icon,
  label,
  description,
  index,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.8 + index * 0.1, duration: 0.4 }}
      className="flex items-start gap-4"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
    </motion.div>
  );
}

export function HomePage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 rounded-xl border border-primary/30 bg-primary/10 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Initializing...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Background grid */}
      <div className="pointer-events-none absolute inset-0 bg-grid-pattern animate-grid-pulse" />
      <div className="pointer-events-none absolute inset-0 hex-pattern opacity-50" />
      {/* Top fade */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent" />
      {/* Bottom fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" />

      {/* Content */}
      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 py-12">
        {/* Top nav bar */}
        <motion.nav
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-16 flex w-full items-center justify-between md:mb-24"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 glow-emerald">
              <Lock className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-wide text-foreground">
                Privacy<span className="text-primary">Proxy</span>
              </span>
              <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                Privacy Protection Platform
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-primary">
                All Systems Operational
              </span>
            </div>
          </div>
          
          {/* Navigation Links */}
          <div className="flex items-center gap-4">
            <Link
              href="/shield"
              className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 transition-all hover:border-primary/40 hover:bg-primary/10"
            >
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Privacy Shield</span>
            </Link>
            <Link
              href="/warroom"
              className="flex items-center gap-2 rounded-lg border border-neon-cyan/20 bg-neon-cyan/5 px-4 py-2 transition-all hover:border-neon-cyan/40 hover:bg-neon-cyan/10"
            >
              <Radar className="h-4 w-4 text-neon-cyan" />
              <span className="text-sm font-medium text-foreground">Analytics</span>
            </Link>
            <Link
              href="/governance"
              className="flex items-center gap-2 rounded-lg border border-neon-amber/20 bg-neon-amber/5 px-4 py-2 transition-all hover:border-neon-amber/40 hover:bg-neon-amber/10"
            >
              <Settings className="h-4 w-4 text-neon-amber" />
              <span className="text-sm font-medium text-foreground">Governance</span>
            </Link>
          </div>
        </motion.nav>

        {/* Hero section */}
        <div className="mb-20 flex flex-col items-center gap-10 text-center md:mb-28">
          {/* Shield orb */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="mb-4"
          >
            <ShieldOrb />
          </motion.div>

          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5"
          >
            <span className="text-[10px] font-mono uppercase tracking-widest text-primary">
              Advanced Privacy Protection System
            </span>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="max-w-3xl text-balance text-4xl font-bold tracking-tight text-foreground md:text-6xl"
          >
            Your AI Firewall for{" "}
            <span className="text-primary text-glow-emerald">Sensitive Data</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg"
          >
            Real-time PII protection, privacy analytics, and compliance governance.
            Enterprise-grade privacy protection for your AI pipelines.
          </motion.p>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            <Link
              href="/shield"
              className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 glow-emerald"
            >
              <Shield className="h-4 w-4" />
              Launch Shield Chat
            </Link>
            <Link
              href="/warroom"
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-all hover:border-primary/30 hover:bg-secondary"
            >
              <Radar className="h-4 w-4" />
              Enter War Room
            </Link>
          </motion.div>
        </div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="mb-20 grid w-full max-w-3xl grid-cols-2 gap-8 rounded-xl border border-border bg-card/50 p-8 backdrop-blur-sm md:grid-cols-4 md:mb-28"
        >
          <StatTicker label="Threats Blocked" value={12847} suffix="+" />
          <StatTicker label="Accuracy Rate" value={99} suffix="%" />
          <StatTicker label="Avg Latency" value={380} suffix="ms" />
          <StatTicker label="Active Agents" value={4} />
        </motion.div>

        {/* Feature cards */}
        <div className="mb-20 w-full md:mb-28">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mb-8 text-center"
          >
            <span className="text-[10px] font-mono uppercase tracking-widest text-primary">
              Command Modules
            </span>
            <h2 className="mt-2 text-2xl font-semibold text-foreground md:text-3xl">
              Three Pillars of Privacy
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <FeatureCard
              icon={Shield}
              title="Privacy Shield"
              description="Split-pane PII interceptor with real-time scanning. Paste untrusted prompts, watch threats get neutralized with glowing redaction badges."
              href="/shield"
              color="emerald"
              tags={["PII Detection", "Real-time", "Regex + ML"]}
              index={0}
            />
            <FeatureCard
              icon={Radar}
              title="Data Analytics"
              description="Live privacy analytics with radar charts, auto-ticking KPIs, terminal-style interceptor logs, and a multi-agent dialogue feed."
              href="/warroom"
              color="cyan"
              tags={["Analytics", "Live Feed", "24h Timeline"]}
              index={1}
            />
            <FeatureCard
              icon={Settings}
              title="Governance"
              description="Configure detection rules, masking strategies, retention policies, and compliance status across GDPR, HIPAA, and PCI-DSS."
              href="/governance"
              color="amber"
              tags={["GDPR", "HIPAA", "PCI-DSS"]}
              index={2}
            />
          </div>
        </div>

        {/* Capabilities section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mb-20 w-full max-w-3xl"
        >
          <div className="mb-8 text-center">
            <span className="text-[10px] font-mono uppercase tracking-widest text-primary">
              Core Capabilities
            </span>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              Built for Zero-Trust AI Pipelines
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <CapabilityItem
              icon={Eye}
              label="Pattern Detection Engine"
              description="Credit cards, SSNs, API keys, emails, phone numbers, medical IDs."
              index={0}
            />
            <CapabilityItem
              icon={Bot}
              label="4-Agent Swarm Architecture"
              description="Inspector, Redactor, Compliance, and Forwarder agents in concert."
              index={1}
            />
            <CapabilityItem
              icon={ShieldCheck}
              label="Three Masking Strategies"
              description="Static replacement, synthetic data generation, or cryptographic hashing."
              index={2}
            />
            <CapabilityItem
              icon={Zap}
              label="Sub-400ms Processing"
              description="Real-time protection with minimal latency overhead on your pipeline."
              index={3}
            />
            <CapabilityItem
              icon={Fingerprint}
              label="Compliance Governance"
              description="GDPR, HIPAA, PCI-DSS, and SOC 2 policy enforcement out of the box."
              index={4}
            />
            <CapabilityItem
              icon={Activity}
              label="Live Privacy Intelligence"
              description="24h timeline, radar distribution, and real-time privacy logging."
              index={5}
            />
          </div>
        </motion.div>

        {/* About Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mb-20 w-full max-w-4xl"
        >
          <div className="mb-8 text-center">
            <span className="text-[10px] font-mono uppercase tracking-widest text-primary">
              About
            </span>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              Solving the Privacy Crisis in AI Pipelines
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* Problem */}
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <h3 className="text-lg font-medium text-foreground">The Problem</h3>
              </div>
              <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
                Modern AI pipelines process massive amounts of sensitive data daily, creating unprecedented privacy risks. Organizations struggle with:
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                  <span>Accidental PII exposure in training data and logs</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                  <span>Compliance violations across GDPR, HIPAA, PCI-DSS</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                  <span>Lack of real-time privacy monitoring and enforcement</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                  <span>Manual redaction processes that are slow and error-prone</span>
                </li>
              </ul>
            </div>

            {/* Solution */}
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-medium text-foreground">Our Solution</h3>
              </div>
              <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
                PrivacyProxy provides enterprise-grade privacy protection through intelligent, automated systems that work seamlessly with existing AI infrastructure:
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span>Real-time PII detection with 99.9% accuracy</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span>Multi-agent architecture for comprehensive coverage</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span>Compliance enforcement across major privacy standards</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span>Sub-400ms processing with minimal pipeline impact</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Authors */}
          <div className="mt-8 rounded-lg border border-border bg-secondary/30 p-6">
            <div className="mb-4 text-center">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Development Team
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="text-center">
                <div className="mb-2 flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                </div>
                <h4 className="text-sm font-medium text-foreground">K. Manichander</h4>
                <p className="text-xs text-muted-foreground">Lead Developer & Privacy Engineer</p>
              </div>
              <div className="text-center">
                <div className="mb-2 flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                </div>
                <h4 className="text-sm font-medium text-foreground">L. Nithish</h4>
                <p className="text-xs text-muted-foreground">AI/ML Engineer & Compliance Expert</p>
              </div>
              <div className="text-center">
                <div className="mb-2 flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                </div>
                <h4 className="text-sm font-medium text-foreground">P. Saishashank</h4>
                <p className="text-xs text-muted-foreground">Frontend Architect & UX Designer</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="flex w-full items-center justify-between border-t border-border pt-8 pb-4"
        >
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              PrivacyProxy v2.0 | Privacy Protection Platform
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="text-[10px] font-mono text-muted-foreground">Uptime: 99.97%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-neon-cyan" />
              <span className="text-[10px] font-mono text-muted-foreground">Latency: 12ms</span>
            </div>
          </div>
        </motion.footer>
      </div>
    </div>
  );
}
