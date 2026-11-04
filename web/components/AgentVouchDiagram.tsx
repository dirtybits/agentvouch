"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  FiSearch,
  FiPackage,
  FiMusic,
  FiDollarSign,
  FiTool,
  FiGitBranch,
  FiArrowRight,
  FiShield,
  FiUsers,
  FiFileText,
} from "react-icons/fi";
import { IoGameControllerOutline } from "react-icons/io5";
import agentvouchLogo from "@/app/agentvouch_logo.svg";
import styles from "./AgentVouchDiagram.module.css";

const agents = [
  { name: "Codex", file: "codex" },
  { name: "Claude Code", file: "claude-code" },
  { name: "Cursor", file: "cursor" },
  { name: "Hermes", file: "hermes" },
  { name: "OpenClaw", file: "openclaw" },
];

const workflows = [
  { name: "Music Production", icon: FiMusic },
  { name: "Financial Modeling", icon: FiDollarSign },
  { name: "Software Development", icon: FiTool },
  { name: "Game Design", icon: IoGameControllerOutline },
  { name: "Agent Orchestration", icon: FiGitBranch },
];

const QUERY = "(prefers-reduced-motion: reduce)";
function subscribe(callback: () => void) {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const steps = [
  "Find a skill for your workflow",
  "Review the author's trust signals",
  "Receive the selected skill package",
];

export function AgentVouchDiagram() {
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true
  );
  const [agentIndex, setAgentIndex] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  useEffect(() => {
    if (reduced || carouselPaused) return;
    const timer = window.setInterval(
      () => setAgentIndex((index) => (index + 1) % agents.length),
      1750
    );
    return () => window.clearInterval(timer);
  }, [reduced, carouselPaused]);
  const [phase, setPhase] = useState(0);
  const [workflowIndex, setWorkflowIndex] = useState(0);
  const workflow = workflows[workflowIndex];
  const WorkflowIcon = workflow.icon;
  useEffect(() => {
    if (reduced) return;
    const started = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - started;
      const time = elapsed % 3500;
      setWorkflowIndex(Math.floor(elapsed / 3500) % workflows.length);
      setPhase(time < 1000 ? 0 : time < 2100 ? 1 : 2);
    }, 80);
    return () => window.clearInterval(timer);
  }, [reduced]);
  return (
    <div className={styles.scene} data-phase={reduced ? "static" : phase}>
      <div className={styles.caption}>
        <span className={styles.status}>
          {reduced ? "Find · Review · Get" : `0${phase + 1} / ${steps[phase]}`}
        </span>
      </div>
      <div className={styles.flow}>
        <article className={styles.card}>
          <div
            className={styles.agentCarousel}
            aria-label="AI agent tools"
            onMouseEnter={() => setCarouselPaused(true)}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement))
                setCarouselPaused(false);
            }}
            onFocus={() => setCarouselPaused(true)}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !event.currentTarget.matches(":hover")
              )
                setCarouselPaused(false);
            }}
          >
            <div className={styles.agentSlide} key={agents[agentIndex].file}>
              <Image
                src={`/agent-logos/${agents[agentIndex].file}.png`}
                alt=""
                width={36}
                height={36}
              />
              <span>{agents[agentIndex].name}</span>
            </div>
            <div className={styles.carouselDots}>
              {agents.map((agent, index) => (
                <button
                  key={agent.file}
                  type="button"
                  aria-label={`Show ${agent.name}`}
                  aria-pressed={agentIndex === index}
                  onClick={() => setAgentIndex(index)}
                />
              ))}
            </div>
          </div>
          <p className={styles.eyebrow}>Your workspace</p>
          <h3>Your AI agent</h3>
          <p>Look for trust-enabled skills.</p>
          <div className={styles.query}>
            <FiSearch />
            <span className={styles.workflowLabel} key={workflow.name}>
              Find a skill for {workflow.name}
            </span>
          </div>
        </article>
        <div
          className={`${styles.connector} ${styles.incoming}`}
          aria-hidden="true"
        >
          <span className={styles.searchPacket}>
            <FiSearch />
          </span>
          <span className={styles.returnPacket}>
            <FiPackage />
          </span>
        </div>
        <article className={`${styles.card} ${styles.oracle}`}>
          <Image src={agentvouchLogo.src} alt="" width="44" height="44" />
          <p className={styles.eyebrow}>Reputation + discovery</p>
          <h3>AgentVouch</h3>
          <p>
            Find skills for your workflow. Review their security scans and
            author reputation.
          </p>
          <div className={styles.signals}>
            <span>
              <FiShield /> Economic backing
            </span>
            <span>
              <FiUsers /> Author vouches
            </span>
            <span>
              <FiFileText /> Report history
            </span>
          </div>
        </article>
        <div
          className={`${styles.connector} ${styles.outgoing}`}
          aria-hidden="true"
        >
          <span className={styles.returnPacket}>
            <FiPackage />
          </span>
          <FiArrowRight className={styles.direction} />
        </div>
        <article className={styles.card}>
          <div className={styles.icon}>
            <FiPackage aria-hidden="true" />
          </div>
          <p className={styles.eyebrow}>Skills marketplace</p>
          <h3>Choose your skill</h3>
          <div className={styles.stack}>
            <div className={styles.backCard} />
            <div className={styles.middleCard} />
            <div className={styles.skill}>
              <div className={styles.skillTitle} key={workflow.name}>
                <WorkflowIcon aria-hidden="true" />
                <span>{workflow.name} Workflow</span>
              </div>
              <span>skill.md</span>
              <span>scripts/</span>
              <span>templates/</span>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
