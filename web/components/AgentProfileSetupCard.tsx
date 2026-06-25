"use client";

import { navButtonPrimaryFlexClass } from "@/lib/buttonStyles";
import { FiArrowRight, FiLoader, FiShield } from "react-icons/fi";

interface AgentProfileSetupCardProps {
  registering: boolean;
  status: string | null;
  onRegister: () => void;
  error: string | null;
  title: string;
  description: string;
  primaryStepLabel: string;
  secondaryStepLabel: string;
  className?: string;
  actionLabel?: string;
  costHint?: string;
}

export function AgentProfileSetupCard({
  registering,
  status,
  onRegister,
  error,
  title,
  description,
  primaryStepLabel,
  secondaryStepLabel,
  className = "max-w-md mx-auto mt-8",
  actionLabel = "Create Profile",
  costHint = "Sponsored checkout can cover Solana fees and rent; direct fallback may require SOL.",
}: AgentProfileSetupCardProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mb-8">
        <span className="flex items-center gap-1.5 font-normal text-gray-900 dark:text-white">
          <span className="w-5 h-5 rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 flex items-center justify-center text-xs font-bold">
            1
          </span>
          {primaryStepLabel}
        </span>
        <FiArrowRight className="w-3.5 h-3.5" />
        <span className="flex items-center gap-1.5 opacity-50">
          <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs">
            2
          </span>
          {secondaryStepLabel}
        </span>
      </div>

      <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 mb-5">
          <FiShield className="w-5 h-5 text-gray-700 dark:text-gray-300" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          {title}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {description}
        </p>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 mb-4">{error}</p>
        )}
        {!error && status && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {status}
          </p>
        )}

        <button
          onClick={onRegister}
          disabled={registering}
          className={`w-full ${navButtonPrimaryFlexClass}`}
        >
          {registering ? (
            <>
              <FiLoader className="w-4 h-4 animate-spin" />
              {status ?? "Creating profile…"}
            </>
          ) : (
            <>
              <FiShield className="w-4 h-4" />
              {actionLabel}
            </>
          )}
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-3">
          {costHint}
        </p>
      </div>
    </div>
  );
}
