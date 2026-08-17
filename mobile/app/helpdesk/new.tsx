import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import {
  priorityLabel,
  SELECTABLE_PRIORITIES,
  validateTicket,
  type TicketField,
  type TicketPriority,
} from "@/lib/helpdesk-rules";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

/**
 * Raise a ticket.
 *
 * Sent immediately and never queued offline, which is a departure from the
 * clock-in and leave forms. Those queue because they are records of something
 * that already happened, and delay costs nothing. A helpdesk ticket is a
 * request for someone's attention now: one written in a basement and delivered
 * three days later arrives after the problem has either resolved itself or
 * become an emergency, and in both cases the SLA clock started at the wrong
 * moment. Better to say plainly that it needs a connection.
 *
 * There is also no queue kind for it — `OperationKind` in the shared core is a
 * closed union — and inventing one to get an outcome nobody wants would be the
 * wrong way round.
 */
export default function NewTicketScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useSession();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [errors, setErrors] = useState<Partial<Record<TicketField, string>>>({});
  const [banner, setBanner] = useState<{ title: string; description?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const raise = useCallback(async () => {
    setBanner(null);

    // Built here rather than in the component body: a fresh object each render
    // changes this callback's identity on every keystroke.
    const found = validateTicket({ subject, body });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const ticket = await api.post<{ id: string }>("/api/helpdesk", {
        subject: subject.trim(),
        body: body.trim(),
        priority,
      });

      // Replaced rather than pushed, so Back from the ticket returns to the
      // list and not to a form that has already been submitted.
      router.replace(`/helpdesk/${ticket.id}`);
    } catch (error) {
      if (error instanceof OfflineError) {
        setBanner({
          title: "This was not sent",
          description:
            "A ticket needs a connection so that the response clock starts when you raised it. Nothing has been lost — try again when you have signal.",
        });
      } else if (error instanceof ApiError) {
        setBanner({ title: "This was not sent", description: error.message });
      } else {
        setBanner({ title: "This was not sent", description: "Please try again." });
      }
    } finally {
      setBusy(false);
    }
  }, [api, subject, body, priority, router]);

  return (
    <Screen keyboardAware>
      {banner ? (
        <Banner
          tone="error"
          title={banner.title}
          description={banner.description}
          style={{ marginBottom: theme.spacing.lg }}
        />
      ) : null}

      <TextField
        label="Subject"
        hint="A short summary — what is wrong"
        value={subject}
        onChangeText={setSubject}
        error={errors.subject}
        maxLength={200}
        editable={!busy}
        returnKeyType="next"
      />

      <AppText variant="footnote" weight="medium" style={{ marginBottom: theme.spacing.sm }}>
        Priority
      </AppText>

      <View accessibilityRole="radiogroup" style={[styles.chips, { marginBottom: theme.spacing.lg }]}>
        {SELECTABLE_PRIORITIES.map((option) => {
          const selected = priority === option;

          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={`${priorityLabel(option)} priority`}
              onPress={() => setPriority(option)}
              disabled={busy}
              hitSlop={4}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                justifyContent: "center",
                paddingHorizontal: theme.spacing.lg,
                marginRight: theme.spacing.sm,
                marginBottom: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceElevated,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
              }}
            >
              <AppText
                variant="footnote"
                tone={selected ? "onPrimary" : "default"}
                weight={selected ? "semibold" : "regular"}
              >
                {priorityLabel(option)}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {/* Said before it is chosen, not enforced afterwards. Every ticket
          marked urgent is the same as none of them being marked urgent. */}
      <AppText variant="caption" tone="muted" style={{ marginBottom: theme.spacing.lg }}>
        Urgent is for something that stops you working today. The helpdesk may
        change the priority once they have read it.
      </AppText>

      <TextField
        label="What is happening?"
        hint="What you were doing, what you expected, and what happened instead"
        value={body}
        onChangeText={setBody}
        error={errors.body}
        multiline
        numberOfLines={6}
        maxLength={20_000}
        editable={!busy}
      />

      <Button label="Send to the helpdesk" onPress={raise} busy={busy} />
      <Button
        label="Cancel"
        variant="ghost"
        onPress={() => router.back()}
        disabled={busy}
        style={{ marginTop: theme.spacing.sm }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap" },
});
