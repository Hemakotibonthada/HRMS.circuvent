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
  const content = (
    <>
      <span className={styles.icon} aria-hidden="true">
        <svg className={styles.iconSvg} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </span>
      <span className={styles.copy}>
        <span className={styles.title}>Continue with SSO</span>
        <span className={styles.subtitle}>Single sign-on · My Account</span>
      </span>
      <svg className={styles.arrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </svg>
    </>
  );
  const classes = `${styles.card} ${compact ? styles.compact : ""} ${className}`;
  return href && !disabled
    ? <a href={href} onClick={onClick} className={classes}>{content}</a>
    : <button type="button" onClick={onClick} disabled={disabled} className={classes}>{content}</button>;
}



