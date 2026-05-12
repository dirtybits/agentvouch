"use client";

import { UsdcIcon } from "@/components/UsdcIcon";

export function UsdcAmount({
  amount,
  className = "",
  iconClassName = "w-3.5 h-3.5",
}: {
  amount: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`.trim()}>
      <UsdcIcon className={iconClassName} />
      <span>{amount} USDC</span>
    </span>
  );
}
