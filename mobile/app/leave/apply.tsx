import { useCallback, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { ApiError } from "@/lib/contracts";
import {
  daysBetween,
  isRealDate,
  todayIso,
  validateLeave,
  type LeaveField,
} from "@/lib/leave-rules";
import { useSync } from "@/lib/sync";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

const LEAVE_TYPES = [
  "casual",
  "sick",
  "earned",
  "maternity",
  "paternity",
  "bereavement",
  "unpaid",
] as const;

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function ApplyLeaveScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { submit } = useSync();

  const today = useMemo(() => todayIso(), []);

  const [leaveType, setLeaveType] = useState<string>("casual");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Partial<Record<LeaveField, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = { leaveType, startDate, endDate, isHalfDay, reason };

  const totalDays = useMemo(() => {
    if (!isRealDate(startDate) || !isRealDate(endDate) || endDate < startDate) return null;
    const days = daysBetween(startDate, endDate);
    return isHalfDay ? 0.5 : days;
  }, [startDate, endDate, isHalfDay]);

  const apply = useCallback(async () => {
    setBanner(null);

    const found = validateLeave(draft, today);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const { sent } = await submit(
        "leave.apply",
        {
          leaveType,
          startDate,
          endDate,
          isHalfDay,
          reason: reason.trim(),
        },
        {
          // Derived from the request itself, so tapping twice — or retrying
          // after a lost response — cannot book the same leave twice.
          id: `leave-${startDate}-${endDate}-${leaveType}-${isHalfDay ? "half" : "full"}`,
          streamKey: "leave",
        }
      );

      if (sent) {
        router.back();
      } else {
        setBanner("Saved on this device. It will be submitted when you have a connection.");
      }
    } catch (error) {
      setBanner(
        error instanceof ApiError ? error.message : "Something went wrong. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }, [draft, today, submit, leaveType, startDate, endDate, isHalfDay, reason, router]);

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={["bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {banner ? (
            <View
              accessibilityRole="alert"
              style={{
                backgroundColor: theme.colors.warningSubtle,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                marginBottom: theme.spacing.lg,
              }}
            >
              <Text
                style={{
                  color: theme.colors.warning,
                  fontSize: theme.fontSize.footnote,
                  lineHeight: theme.lineHeight.footnote,
                }}
              >
                {banner}
              </Text>
            </View>
          ) : null}

          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.fontSize.footnote,
              lineHeight: theme.lineHeight.footnote,
              fontWeight: theme.fontWeight.medium,
              marginBottom: theme.spacing.sm,
            }}
          >
            Leave type
          </Text>

          {/* A row of buttons rather than a picker. Seven options fit, and a
              native picker on Android is a modal that hides the rest of the
              form — including the error the person is trying to fix. */}
          <View
            accessibilityRole="radiogroup"
            style={[styles.chips, { marginBottom: theme.spacing.lg }]}
          >
            {LEAVE_TYPES.map((type) => {
              const selected = leaveType === type;
              return (
                <Pressable
                  key={type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  accessibilityLabel={`${titleCase(type)} leave`}
                  onPress={() => setLeaveType(type)}
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
                  <Text
                    style={{
                      color: selected ? theme.colors.onPrimary : theme.colors.text,
                      fontSize: theme.fontSize.footnote,
                      fontWeight: selected ? theme.fontWeight.semibold : theme.fontWeight.regular,
                    }}
                  >
                    {titleCase(type)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {errors.leaveType ? (
            <Text
              accessibilityRole="alert"
              style={{
                color: theme.colors.danger,
                fontSize: theme.fontSize.footnote,
                marginBottom: theme.spacing.md,
              }}
            >
              {errors.leaveType}
            </Text>
          ) : null}

          <TextField
            label="Start date"
            hint="YYYY-MM-DD"
            value={startDate}
            onChangeText={(next) => {
              setStartDate(next);
              // A half day is one day, so the end follows the start rather
              // than being left behind at a stale value the user cannot see.
              if (isHalfDay) setEndDate(next);
            }}
            error={errors.startDate}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
            editable={!busy}
          />

          <TextField
            label="End date"
            hint={isHalfDay ? "Same as the start date for a half day" : "YYYY-MM-DD"}
            value={endDate}
            onChangeText={setEndDate}
            error={errors.endDate}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
            editable={!busy && !isHalfDay}
          />

          <View style={[styles.between, { marginBottom: theme.spacing.lg }]}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.fontSize.body,
                lineHeight: theme.lineHeight.body,
              }}
            >
              Half day
            </Text>
            <Switch
              value={isHalfDay}
              onValueChange={(next) => {
                setIsHalfDay(next);
                if (next) setEndDate(startDate);
              }}
              accessibilityLabel="Half day"
              accessibilityHint="Applies for half of a single day"
              disabled={busy}
            />
          </View>

          {totalDays !== null ? (
            // Shown before submitting, because the number of days is the thing
            // that comes off the balance and the one people get wrong.
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.fontSize.footnote,
                lineHeight: theme.lineHeight.footnote,
                marginBottom: theme.spacing.lg,
              }}
            >
              This will use {totalDays} {totalDays === 1 ? "day" : "days"} of your balance.
            </Text>
          ) : null}

          <TextField
            label="Reason"
            value={reason}
            onChangeText={setReason}
            error={errors.reason}
            multiline
            numberOfLines={3}
            maxLength={1000}
            editable={!busy}
          />

          <Button label="Submit request" onPress={apply} busy={busy} />
          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => router.back()}
            style={{ marginTop: theme.spacing.sm }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
