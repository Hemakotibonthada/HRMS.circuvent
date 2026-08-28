// ═══════════════════════════════════════════════════════════════
// CLICKABLE — keyboard parity for elements that are not buttons
// ═══════════════════════════════════════════════════════════════
// A `<div onClick>` works with a mouse and does not exist to anybody else.
// It is not focusable, so keyboard and switch-control users cannot reach it,
// and it has no role, so a screen reader announces its text as prose with no
// hint that anything happens if you activate it.
//
// The honest fix is usually a real `<button>`. Where that is impractical —
// a card with its own internal layout, a table row, a list item that also
// contains buttons — this supplies the four things a button gives for free,
// in one tested place rather than fourteen hand-rolled copies that each
// forget a different one of them.
//
// Returns plain props rather than being a hook, so it is pure and testable
// without rendering anything.

import type { KeyboardEvent, MouseEvent } from "react";

export interface ClickableOptions {
  /** Announced by a screen reader. Omit only when the content already says it. */
  label?: string;
  disabled?: boolean;
  /**
   * `button` for something that acts, `link` for something that navigates.
   * The distinction is not cosmetic: a screen reader user is told what will
   * happen, and Space activates a button while only Enter follows a link.
   */
  role?: "button" | "link";
}

export interface ClickableProps {
  role: "button" | "link";
  tabIndex: number;
  "aria-label"?: string;
  "aria-disabled"?: true;
  onClick: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * True when the event came from a nested control that handles itself.
 *
 * Without this, a card wrapped in an activation handler fires its own action
 * as well as the delete button inside it — the user deletes a row and opens
 * it at the same time.
 */
function fromNestedControl(target: EventTarget | null, currentTarget: EventTarget | null): boolean {
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) return false;
  if (target === currentTarget) return false;

  const interactive = target.closest(
    "a[href], button, input, select, textarea, [role='button'], [role='link'], [role='checkbox'], [role='menuitem']"
  );
  return interactive !== null && interactive !== currentTarget && currentTarget.contains(interactive);
}

export function clickable(onActivate: () => void, options: ClickableOptions = {}): ClickableProps {
  const { label, disabled = false, role = "button" } = options;

  const activate = (event: MouseEvent | KeyboardEvent) => {
    if (disabled) return;
    if (fromNestedControl(event.target, event.currentTarget)) return;
    onActivate();
  };

  return {
    role,
    // -1 keeps a disabled element out of the tab order without removing it
    // from the accessibility tree, which is what `aria-disabled` is for.
    tabIndex: disabled ? -1 : 0,
    ...(label ? { "aria-label": label } : {}),
    ...(disabled ? { "aria-disabled": true as const } : {}),
    onClick: activate,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        activate(event);
        return;
      }

      // Space activates a button but not a link, matching native behaviour.
      // preventDefault stops the page scrolling underneath, which is what
      // Space otherwise does and is disorienting when the thing you just
      // activated has also moved.
      if (event.key === " " && role === "button") {
        event.preventDefault();
        activate(event);
      }
    },
  };
}
