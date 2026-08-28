import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent, MouseEvent } from "react";
import { clickable } from "./clickable";

/** A keyboard event carrying only what `clickable` reads. */
function keyEvent(key: string, target?: Element, currentTarget?: Element) {
  return {
    key,
    target: target ?? null,
    currentTarget: currentTarget ?? null,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

function mouseEvent(target?: Element, currentTarget?: Element) {
  return {
    target: target ?? null,
    currentTarget: currentTarget ?? null,
  } as unknown as MouseEvent;
}

describe("the props it produces", () => {
  it("makes the element reachable and announced", () => {
    const props = clickable(() => {}, { label: "Open payslip" });
    expect(props.role).toBe("button");
    expect(props.tabIndex).toBe(0);
    expect(props["aria-label"]).toBe("Open payslip");
  });

  it("omits aria-label when the content already speaks for itself", () => {
    // An empty aria-label is worse than none: it silences the text inside.
    expect(clickable(() => {})["aria-label"]).toBeUndefined();
  });

  it("takes a disabled element out of the tab order but leaves it announced", () => {
    const props = clickable(() => {}, { disabled: true });
    expect(props.tabIndex).toBe(-1);
    expect(props["aria-disabled"]).toBe(true);
  });

  it("can present as a link", () => {
    expect(clickable(() => {}, { role: "link" }).role).toBe("link");
  });
});

describe("activation", () => {
  it("fires on click", () => {
    const onActivate = vi.fn();
    clickable(onActivate).onClick(mouseEvent());
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("fires on Enter", () => {
    const onActivate = vi.fn();
    clickable(onActivate).onKeyDown(keyEvent("Enter"));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("fires on Space for a button", () => {
    const onActivate = vi.fn();
    const event = keyEvent(" ");
    clickable(onActivate).onKeyDown(event);
    expect(onActivate).toHaveBeenCalledOnce();
    // Otherwise the page scrolls underneath the thing just activated.
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("ignores Space for a link, as a browser does", () => {
    const onActivate = vi.fn();
    clickable(onActivate, { role: "link" }).onKeyDown(keyEvent(" "));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("ignores every other key", () => {
    const onActivate = vi.fn();
    const props = clickable(onActivate);
    for (const key of ["a", "Tab", "Escape", "ArrowDown", "Shift"]) {
      props.onKeyDown(keyEvent(key));
    }
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does nothing at all when disabled", () => {
    const onActivate = vi.fn();
    const props = clickable(onActivate, { disabled: true });
    props.onClick(mouseEvent());
    props.onKeyDown(keyEvent("Enter"));
    props.onKeyDown(keyEvent(" "));
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("nested controls", () => {
  function card() {
    const container = document.createElement("div");
    const button = document.createElement("button");
    const text = document.createElement("span");
    container.append(button, text);
    return { container, button, text };
  }

  it("does not fire when the click came from a button inside it", () => {
    // The bug this prevents: tapping "Delete" on a card both deletes the row
    // and opens it.
    const { container, button } = card();
    const onActivate = vi.fn();
    clickable(onActivate).onClick(mouseEvent(button, container));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("fires when the click came from ordinary content inside it", () => {
    const { container, text } = card();
    const onActivate = vi.fn();
    clickable(onActivate).onClick(mouseEvent(text, container));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("fires when the element itself was clicked", () => {
    const { container } = card();
    const onActivate = vi.fn();
    clickable(onActivate).onClick(mouseEvent(container, container));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("recognises a link, an input and an aria role as nested controls", () => {
    for (const html of [
      '<a href="/x">go</a>',
      "<input />",
      "<select></select>",
      "<textarea></textarea>",
      '<div role="checkbox"></div>',
      '<div role="menuitem"></div>',
    ]) {
      const container = document.createElement("div");
      container.innerHTML = html;
      const inner = container.firstElementChild as Element;
      const onActivate = vi.fn();
      clickable(onActivate).onClick(mouseEvent(inner, container));
      expect(onActivate, html).not.toHaveBeenCalled();
    }
  });

  it("still fires when the target is not a DOM element at all", () => {
    // Synthetic events in tests, and some non-DOM renderers, do not give a
    // real Element. Refusing to activate there would break the common case
    // to guard the rare one.
    const onActivate = vi.fn();
    clickable(onActivate).onClick(mouseEvent());
    expect(onActivate).toHaveBeenCalledOnce();
  });
});
