import {
  FiCheckCircle,
  FiAlertTriangle,
  FiXCircle,
  FiCircle,
} from "react-icons/fi";
import type { TrustSignal, TrustSignalStatus } from "@/lib/trustSignals";
import type { SkillSecurityScan } from "@/lib/securityScan";

const STATUS_META: Record<
  TrustSignalStatus,
  { Icon: typeof FiCheckCircle; tone: string; word: string }
> = {
  pass: {
    Icon: FiCheckCircle,
    tone: "text-emerald-700 dark:text-emerald-300",
    word: "pass",
  },
  warn: {
    Icon: FiAlertTriangle,
    tone: "text-amber-700 dark:text-amber-300",
    word: "review",
  },
  fail: {
    Icon: FiXCircle,
    tone: "text-red-700 dark:text-red-300",
    word: "fail",
  },
  unknown: {
    Icon: FiCircle,
    tone: "text-neutral-500 dark:text-neutral-400",
    word: "n/a",
  },
};

// The transparent trust checklist: each signal is an independent advisory fact a
// reader (or agent) can weigh against its own policy, rather than one opaque
// verdict. Only staked on-chain trust grants `allow`; the scan never does.
export function TrustSignalChecklist({
  signals,
  scan,
}: {
  signals: TrustSignal[] | null | undefined;
  scan?: SkillSecurityScan | null;
}) {
  if (!signals || signals.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-800 dark:bg-gray-900/50">
      <p className="text-sm font-semibold">Trust signals</p>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        Independent advisory checks. Only staked on-chain trust grants allow.
      </p>
      <ul className="mt-3 space-y-2">
        {signals.map((signal) => {
          const meta = STATUS_META[signal.status];
          const Icon = meta.Icon;
          return (
            <li key={signal.id} className="flex items-start gap-2">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.tone}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {signal.label}{" "}
                  <span
                    className={`font-mono text-[10px] uppercase ${meta.tone}`}
                  >
                    {meta.word}
                  </span>
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {signal.detail}
                </p>
                {signal.id === "ai_scan" && scan?.findings?.length ? (
                  <ul className="mt-1 space-y-1 font-mono text-xs text-neutral-500 dark:text-neutral-400">
                    {scan.findings.slice(0, 3).map((f) => (
                      <li
                        key={`${f.file}:${f.detail}`}
                        className="line-clamp-2"
                      >
                        {f.severity.toUpperCase()} · {f.file}: {f.detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default TrustSignalChecklist;
