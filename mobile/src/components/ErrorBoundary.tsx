// ═══════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ═══════════════════════════════════════════════════════════════
// The app had none. In React, an exception thrown while rendering unmounts the
// whole tree — so a single bad field on a single payslip did not break the
// payslip screen, it left the person holding a black rectangle with no way
// back and nothing to report. On a phone there is not even a browser reload to
// fall back on.
//
// Three decisions worth stating:
//
//   * The message names no exception and shows no stack. A stack trace is
//     useless to the person reading it and tells anyone else about the shape
//     of the code. What is offered instead is the one thing that helps: try
//     again, and if that fails, sign out.
//   * It says what has *not* been lost. The first question after a crash in an
//     app that queues work offline is whether the clock-in survived, and the
//     answer — that the queue is on disk, not in the render tree — is the
//     difference between a shrug and a phone call to HR.
//   * "Try again" remounts the subtree by changing a key, rather than
//     re-rendering the same broken element and throwing at the same place.
//   * It is a class. React has no hook form of componentDidCatch, and
//     `getDerivedStateFromError` is the only way to render a fallback for an
//     error thrown during a child's render. The fallback is split into a
//     function component so it can still use the theme: the provider sits
//     above this boundary, so the palette survives the crash.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { View } from "react-native";
import { Button } from "@/components/Button";
import { AppText } from "@/components/Typography";
import { useTheme } from "@/theme/ThemeProvider";

interface Props {
  children: ReactNode;
  /** Called when the user asks to start over — usually a sign-out. */
  onReset?: () => void;
}

interface State {
  failed: boolean;
  /** Bumped on retry so the children remount rather than re-render. */
  attempt: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged, not shown. This is the only record that the crash happened, and
    // without it the report is "it went white" with nothing attached.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  private retry = (): void => {
    this.setState((previous) => ({ failed: false, attempt: previous.attempt + 1 }));
  };

  render(): ReactNode {
    if (this.state.failed) {
      return <ErrorFallback onRetry={this.retry} onReset={this.props.onReset} />;
    }

    return (
      <View key={this.state.attempt} style={{ flex: 1 }}>
        {this.props.children}
      </View>
    );
  }
}

function ErrorFallback({ onRetry, onReset }: { onRetry: () => void; onReset?: () => void }) {
  const theme = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: theme.spacing.xl,
        backgroundColor: theme.colors.background,
      }}
    >
      <View style={{ maxWidth: 340, alignItems: "center" }}>
        <AppText variant="title3" weight="semibold" align="center" heading>
          This screen stopped working
        </AppText>

        <AppText
          variant="body"
          tone="muted"
          align="center"
          style={{ marginTop: theme.spacing.sm }}
        >
          Nothing you have already sent is affected, and anything waiting to be
          sent is still saved on this device.
        </AppText>

        <Button
          label="Try again"
          onPress={onRetry}
          accessibilityHint="Reloads the app from the start"
          style={{ marginTop: theme.spacing.xl }}
        />

        {onReset ? (
          <Button
            label="Sign out"
            variant="ghost"
            onPress={onReset}
            accessibilityHint="Signs you out and returns to the sign-in screen"
            style={{ marginTop: theme.spacing.sm }}
          />
        ) : null}
      </View>
    </View>
  );
}
