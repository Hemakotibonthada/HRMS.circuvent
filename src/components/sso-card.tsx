"use client";

import type { MouseEventHandler } from "react";
import styles from "@/components/sso-card.module.css";

type SsoCardProps = {
  href?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
};

/** Suite-wide visual treatment only; callers retain their existing SSO flow. */
export function SsoCard({ href, onClick, disabled = false, className = "", compact = false }: SsoCardProps) {
  const content = <>
    <span className={styles.icon} aria-hidden="true">
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8.5 12 2.3 2.3 4.7-4.7" />
      </svg>
    </span>
    <span className={styles.copy}>
      <span className={styles.title}>Continue with SSO</span>
      <span className={styles.subtitle}>Single sign-on · My Account</span>
    </span>
    <svg className={styles.arrow} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  </>;
  const classes = `${styles.card} ${compact ? styles.compact : ""} ${className}`;
  return href && !disabled
    ? <a href={href} onClick={onClick} className={classes}>{content}</a>
    : <button type="button" onClick={onClick} disabled={disabled} className={classes}>{content}</button>;
}
