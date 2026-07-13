export const navButtonSizeClass = "h-9 px-3 text-sm rounded-lg";

export const navButtonInlineClass = `inline-flex items-center justify-center gap-2 ${navButtonSizeClass}`;

export const navButtonFlexClass = `flex items-center justify-center gap-2 ${navButtonSizeClass}`;

export const navIconButtonClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg";

const lobsterButtonBaseClass =
  "transition disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed";

export const navButtonPrimaryInlineClass = `${navButtonInlineClass} font-normal bg-[var(--lobster-accent-strong)] text-white hover:bg-[var(--lobster-accent)] ${lobsterButtonBaseClass}`;

export const navButtonPrimaryFlexClass = `${navButtonFlexClass} font-normal bg-[var(--lobster-accent-strong)] text-white hover:bg-[var(--lobster-accent)] ${lobsterButtonBaseClass}`;

export const navButtonSecondaryInlineClass = `${navButtonInlineClass} font-normal bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] border border-[var(--sea-accent-border)] hover:bg-[var(--sea-accent-soft-hover)] transition`;

export const navButtonSecondaryFlexClass = `${navButtonFlexClass} font-normal bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] border border-[var(--sea-accent-border)] hover:bg-[var(--sea-accent-soft-hover)] transition`;

export const navPillActiveClass =
  "bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] border border-[var(--sea-accent-border)]";

export const navPillIdleClass =
  "text-gray-600 dark:text-gray-400 hover:text-[var(--sea-accent)] hover:bg-[var(--sea-accent-soft)]";
