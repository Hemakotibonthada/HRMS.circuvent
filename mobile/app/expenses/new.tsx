import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import { formatMoney } from "@shared/money/format";
import {
  EXPENSE_CATEGORIES,
  categoryLimitMinor,
  totalOfLineItems,
  validateClaim,
  type ExpenseLineItem,
} from "@shared/expense-rules";
import { dateKeyInZone } from "@shared/date-keys";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

interface DraftLine {
  description: string;
  /** What the person typed, in rupees. Converted to paise on submit. */
  rupees: string;
}

/**
 * Converts typed rupees to exact paise.
 *
 * String arithmetic rather than `Math.round(Number(x) * 100)`, because that
 * route turns "1234.56" into 123455.99999999999 and then rounds — fine here,
 * but the same pattern is wrong at scale and there is no reason to write the
 * fragile version. Returns null for anything that is not money.
 */
export function rupeesToMinor(input: string): string | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;

  const [whole, fraction = ""] = trimmed.split(".");
  return `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
}

/**
 * File an expense claim.
 *
 * Validated with the same `validateClaim` the server runs, imported from the
 * shared core rather than reimplemented. A phone that disagrees with the
 * server about the rules produces the worst failure mode there is: a form that
 * accepts something the API then rejects, with no way for the person to tell
 * which of them is wrong.
 *
 * Sent immediately rather than queued. A claim is a request for money and the
 * amounts are validated server-side against category limits; queuing one would
 * mean telling somebody their claim is filed when it may still be refused.
 */
export default function NewExpenseScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useSession();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("travel");
  const [expenseDate, setExpenseDate] = useState(dateKeyInZone(new Date()));
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ description: "", rupees: "" }]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);

  const parsedLines = useMemo<ExpenseLineItem[]>(
    () =>
      lines
        .map((line) => {
          const amountMinor = rupeesToMinor(line.rupees);
          return amountMinor === null
            ? null
            : { description: line.description, amountMinor };
        })
        .filter((line): line is ExpenseLineItem => line !== null),
    [lines]
  );

  const totalMinor = useMemo(() => totalOfLineItems(parsedLines), [parsedLines]);
  const limitMinor = categoryLimitMinor(category);
  const overLimit = limitMinor !== null && BigInt(totalMinor) > limitMinor;

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((previous) =>
      previous.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  };

  const submit = useCallback(async () => {
    const today = dateKeyInZone(new Date());
    const validation = validateClaim(
      { title, category, expenseDate, lineItems: parsedLines, description },
      today
    );

    if (!validation.ok) {
      setError({ title: "This claim is not ready", description: validation.errors.join("\n") });
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/expenses", {
        title: title.trim(),
        category,
        expenseDate,
        description: description.trim() || undefined,
        lineItems: parsedLines,
      });
      router.replace("/expenses");
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError({
          title: "You are offline",
          description:
            "A claim is checked against your category limit when it is filed, so it needs a connection. Nothing has been lost — try again when you have signal.",
        });
      } else if (caught instanceof ApiError) {
        setError({ title: "This claim was not accepted", description: caught.message });
      } else {
        setError({ title: "This claim could not be filed" });
      }
    } finally {
      setSubmitting(false);
    }
  }, [api, category, description, expenseDate, parsedLines, router, title]);

  return (
    <Screen scrollable keyboardAware>
      {error ? (
        <Banner
          tone={error.title === "You are offline" ? "warning" : "error"}
          title={error.title}
          description={error.description}
          style={{ marginBottom: theme.spacing.md }}
        />
      ) : null}

      <TextField
        label="What was it for?"
        value={title}
        onChangeText={setTitle}
        placeholder="Client visit, Pune"
        maxLength={200}
      />

      <AppText variant="footnote" weight="medium" style={{ marginBottom: theme.spacing.xs }}>
        Category
      </AppText>
      <View style={styles.chips}>
        {EXPENSE_CATEGORIES.map((option) => {
          const selected = option === category;
          return (
            <Pressable
              key={option}
              onPress={() => setCategory(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceElevated,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                },
              ]}
            >
              <AppText
                variant="footnote"
                weight={selected ? "semibold" : "regular"}
                tone={selected ? "onPrimary" : "default"}
              >
                {option}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <TextField
        label="When"
        value={expenseDate}
        onChangeText={setExpenseDate}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        hint="The day the money was spent, not today."
      />

      <AppText
        variant="footnote"
        weight="medium"
        style={{ marginTop: theme.spacing.md, marginBottom: theme.spacing.xs }}
      >
        What you spent
      </AppText>

      {lines.map((line, index) => (
        <Card key={index} style={{ marginBottom: theme.spacing.sm }}>
          <TextField
            label={`Line ${index + 1}`}
            value={line.description}
            onChangeText={(next) => updateLine(index, { description: next })}
            placeholder="Return flight"
            maxLength={500}
          />
          <TextField
            label="Amount (₹)"
            value={line.rupees}
            onChangeText={(next) => updateLine(index, { rupees: next })}
            keyboardType="decimal-pad"
            placeholder="12000.00"
            error={
              line.rupees.trim() !== "" && rupeesToMinor(line.rupees) === null
                ? "Enter an amount like 1234.56"
                : undefined
            }
          />
          {lines.length > 1 ? (
            <Button
              label="Remove this line"
              variant="ghost"
              onPress={() => setLines((previous) => previous.filter((_, i) => i !== index))}
            />
          ) : null}
        </Card>
      ))}

      <Button
        label="Add another line"
        variant="secondary"
        onPress={() => setLines((previous) => [...previous, { description: "", rupees: "" }])}
      />

      <Card style={{ marginTop: theme.spacing.md }}>
        <View style={styles.between}>
          <AppText variant="body" style={styles.grow}>
            Total
          </AppText>
          <AppText variant="title3" weight="bold">
            {formatMoney(Number(totalMinor) / 100)}
          </AppText>
        </View>

        {/* Said before submitting, not after being rejected. The limit is
            enforced server-side either way; showing it here is the difference
            between "adjust this line" and "start again". */}
        {overLimit && limitMinor !== null ? (
          <AppText variant="caption" tone="danger" style={{ marginTop: theme.spacing.xs }}>
            Over the {category} limit of {formatMoney(Number(limitMinor) / 100)}. Split it across
            claims, or check the category.
          </AppText>
        ) : null}
      </Card>

      <TextField
        label="Anything else? (optional)"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        maxLength={2000}
      />

      <Button
        label="File this claim"
        busy={submitting}
        disabled={overLimit}
        onPress={() => void submit()}
        accessibilityHint="Sends the claim for approval"
        style={{ marginTop: theme.spacing.lg }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
});
