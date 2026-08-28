// ═══════════════════════════════════════════════════════════════
// THEME PROVIDER
// ═══════════════════════════════════════════════════════════════
// Follows the OS setting by default. There is no in-app theme toggle, and
// that is a decision rather than an omission: people set dark mode once, at
// the system level, usually for a reason — light sensitivity, migraine,
// working nights. An app that ignores it, or that needs its own switch set
// separately, is one more thing to get wrong.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { buildTheme, type Theme } from "./tokens";

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  // `useColorScheme` returns null while the setting is being read. Treating
  // null as dark would flash a dark screen on a light-mode device at every
  // cold start.
  const theme = useMemo(() => buildTheme(scheme === "dark"), [scheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    // A default here would let a component render unthemed and look almost
    // right, which is harder to spot than a crash during development.
    throw new Error("useTheme must be used inside a ThemeProvider");
  }
  return theme;
}
