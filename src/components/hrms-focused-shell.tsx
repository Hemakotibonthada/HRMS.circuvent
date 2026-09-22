"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Search,
  UserRound,
  LogOut,
  Settings,
  Users,
  Clock,
  CreditCard,
  Sparkles,
  MessageSquare,
  Sliders,
  FolderKanban,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationCenter } from "@/components/notification-center";
import { EcosystemSwitcher } from "@/components/ecosystem-switcher";
import { HrmsPortalSwitcher } from "@/components/hrms-portal-switcher";
import { useHrmsPortal } from "@/components/hrms-portal-provider";
import { useAuth, signOutSession } from "@/hooks/use-auth";
import { HRMS_PORTALS, portalHome } from "@/lib/hrms-portals";
import { navigationGroups, activeNavigationGroup } from "@/lib/hrms-navigation";
import styles from "./hrms-focused-shell.module.css";

const GROUP_ICONS: Record<string, LucideIcon> = {
  personal: UserRound,
  people: Users,
  time: Clock,
  pay: CreditCard,
  talent: Sparkles,
  connect: MessageSquare,
  operations: Sliders,
  more: FolderKanban,
};

export function HrmsFocusedShell({ children }: { children: React.ReactNode }) {
  const portal = useHrmsPortal();
  const pathname = usePathname();
  const { user } = useAuth();
  const groups = navigationGroups(portal, user?.role ?? "");
  const activeGroup = activeNavigationGroup(groups, pathname);
  const home = portalHome(portal);
  return <div className={styles.shell}>
    <a href="#portal-content" className={styles.skip}>Skip to content</a>
    <header className={styles.header}>
      <div className={styles.topbar}>
        <Link href={home} className={styles.brand}><BrandMark size={32} /><span><strong>{HRMS_PORTALS[portal].name}</strong><small>Circuvent</small></span></Link>
        <nav aria-label="Workspace sections" className={styles.tabs}>
          <Link href={home} aria-current={pathname === home ? "page" : undefined}><Home size={16} />Home</Link>
          {groups.map(group => {
            const GroupIcon = GROUP_ICONS[group.id] || FolderKanban;
            return (
              <Link key={group.id} href={group.items[0].href} aria-current={activeGroup?.id === group.id ? "true" : undefined}>
                <GroupIcon size={15} />
                {group.label}
              </Link>
            );
          })}
        </nav>
        <div className={styles.actions}>
          <button type="button" aria-label="Search HRMS tools" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}><Search size={18} /></button>
          <NotificationCenter /><EcosystemSwitcher current="hrms" /><ThemeToggle />
          <details className={styles.account} key={pathname}>
            <summary aria-label="Your account and workspaces"><UserRound size={19} /></summary>
            <div className={styles.accountPanel}>
              <strong>{user?.displayName || "Your account"}</strong><small>{user?.email}</small>
              <Link href="/myprofile"><UserRound size={15} />My profile</Link>
              <Link href="/settings"><Settings size={15} />Settings</Link>
              <HrmsPortalSwitcher />
              <button type="button" onClick={() => void signOutSession()}><LogOut size={15} />Sign out</button>
            </div>
          </details>
        </div>
      </div>
      {activeGroup && <nav className={styles.features} aria-label={`${activeGroup.label} features`}>
        {activeGroup.items.map(item => <Link key={item.id} href={item.href} aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "page" : undefined}><item.icon size={15} />{item.name}</Link>)}
      </nav>}
    </header>
    <main id="portal-content" tabIndex={-1} className={styles.content}>{children}</main>
    <footer className={styles.footer}>{HRMS_PORTALS[portal].name} · Circuvent</footer>
  </div>;
}
