import { useMemo } from "react";
import { View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/Typography";
import { useSession } from "@/lib/session";
import { useSync } from "@/lib/sync";
import { useTheme } from "@/theme/ThemeProvider";

type IconName = React.ComponentProps<typeof Feather>["name"];

/** Roles the server will actually let approve. */
const APPROVER_ROLES = ["owner", "admin", "hr", "manager"];

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  hr: "HR",
  manager: "Manager",
  employee: "Employee",
};

/**
 * Profile.
 *
 * The fifth tab, and the home for everything that is neither a daily action
 * nor a list: who you are signed in as, what the app is still holding on your
 * behalf, and the way to the screens that are visited monthly rather than
 * daily.
 *
 * The unsent-work count is here as well as on Today deliberately. Today shows
 * it because it is the screen open when the queue fills; this shows it because
 * it is the screen someone opens when they are wondering whether the app has
 * done what they asked.
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useSession();
  const { pending, quarantined, syncing } = useSync();

  const initials = useMemo(() => {
    if (!user) return "";
    const first = user.firstName.trim().charAt(0);
    const last = user.lastName.trim().charAt(0);
    return `${first}${last}`.toUpperCase();
  }, [user]);

  const canApprove = user ? APPROVER_ROLES.includes(user.role) : false;

  return (
    <Screen tabBarInset>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View
            // Decorative: the name is read out immediately after it, so an
            // avatar that announces "AB" makes a screen reader say the initials
            // and then the name.
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={{
              width: 56,
              height: 56,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.primarySubtle,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AppText variant="title3" weight="bold" tone="primary">
              {initials}
            </AppText>
          </View>

          <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
            <AppText variant="title3" weight="semibold" heading numberOfLines={1}>
              {user ? `${user.firstName} ${user.lastName}` : "Signed in"}
            </AppText>
            <AppText variant="footnote" tone="muted" numberOfLines={1}>
              {user?.email ?? ""}
            </AppText>
            {user ? (
              <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>
                {ROLE_LABEL[user.role] ?? user.role}
              </AppText>
            ) : null}
          </View>
        </View>
      </Card>

      {quarantined.length > 0 ? (
        <Banner
          tone="error"
          title={
            quarantined.length === 1
              ? "1 action was refused"
              : `${quarantined.length} actions were refused`
          }
          description="They will not be retried on their own. Open Today to retry or discard them."
          action={
            <Button
              label="Open Today"
              variant="ghost"
              fullWidth={false}
              onPress={() => router.replace("/")}
            />
          }
          style={{ marginTop: theme.spacing.md }}
        />
      ) : pending.length > 0 ? (
        <Banner
          tone="info"
          title={
            pending.length === 1
              ? "1 action waiting to be sent"
              : `${pending.length} actions waiting to be sent`
          }
          description={
            syncing
              ? "Sending now."
              : "They are saved on this device and will be sent when you have a connection."
          }
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}

      <AppText
        variant="footnote"
        weight="semibold"
        tone="muted"
        heading
        style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm }}
      >
        Your record
      </AppText>

      <Link
        icon="calendar"
        label="Attendance history"
        description="Your punches, month by month"
        onPress={() => router.push("/attendance")}
      />

      <Link
        icon="file-text"
        label="Payslips"
        description="Released payslips, oldest last"
        onPress={() => router.replace("/payslips")}
      />

      <Link
        icon="credit-card"
        label="Expenses"
        description="Claim what you spent, and see what is still owed"
        onPress={() => router.push("/expenses")}
      />

      <Link
        icon="help-circle"
        label="Helpdesk"
        description="Raise a ticket with HR or IT, and track it"
        onPress={() => router.push("/helpdesk")}      />

      {canApprove ? (
        <>
          <AppText
            variant="footnote"
            weight="semibold"
            tone="muted"
            heading
            style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm }}
          >
            Your team
          </AppText>

          {/* Shown only to roles the server will accept. A row that always
              returns 403 reads as a broken app rather than as a boundary. */}
          <Link
            icon="check-square"
            label="Approvals"
            description="Leave requests waiting for your decision"
            onPress={() => router.push("/approvals")}
          />
        </>
      ) : null}

      <AppText
        variant="footnote"
        weight="semibold"
        tone="muted"
        heading
        style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm }}
      >
        This device
      </AppText>

      <Link
        icon="lock"
        label="Settings"
        description="Biometric unlock and sign out"
        onPress={() => router.push("/settings")}
      />

      <Button
        label="Sign out"
        variant="secondary"
        onPress={() => void signOut()}
        accessibilityHint="Signs you out on this device. Anything already sent is unaffected."
        style={{ marginTop: theme.spacing.xxl }}
      />

      {pending.length > 0 ? (
        // Said before they tap, not after. Signing out with unsent work is a
        // decision someone should make knowingly.
        <AppText
          variant="caption"
          tone="muted"
          align="center"
          style={{ marginTop: theme.spacing.sm }}
        >
          {pending.length === 1
            ? "1 action has not been sent yet."
            : `${pending.length} actions have not been sent yet.`}
        </AppText>
      ) : null}
    </Screen>
  );
}

function Link({
  icon,
  label,
  description,
  onPress,
}: {
  icon: IconName;
  label: string;
  description: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={description}
      style={{ marginBottom: theme.spacing.sm }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Feather name={icon} size={20} color={theme.colors.textMuted} />

        <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
          <AppText variant="body" weight="medium">
            {label}
          </AppText>
          <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {description}
          </AppText>
        </View>

        <Feather name="chevron-right" size={20} color={theme.colors.textMuted} />
      </View>
    </Card>
  );
}
