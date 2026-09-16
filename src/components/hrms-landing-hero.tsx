"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Users, CalendarDays, Clock, ShieldCheck, Check, LayoutDashboard, Bell, Search, ChevronRight } from "lucide-react";
import styles from "./hrms-landing-hero.module.css";

const previews = {
  people: { title: "A great day starts with your people.", subtitle: "Your team, together in one place.", metric: "Team members", value: "128", secondary: "Departments", secondValue: "8", heading: "Your people", rows: [["AR", "Aditi Rao", "Product design", "Active"], ["RK", "Rohan Kumar", "Engineering", "Active"], ["SP", "Sara Patel", "People operations", "Onboarding"]] },
  attendance: { title: "A clear picture of the working day.", subtitle: "Bring attendance, shifts and exceptions together.", metric: "Checked in", value: "116", secondary: "On leave", secondValue: "8", heading: "Today’s attendance", rows: [["AR", "Aditi Rao", "09:04 · Office", "Present"], ["RK", "Rohan Kumar", "09:12 · Remote", "Present"], ["SP", "Sara Patel", "General shift", "On leave"]] },
  leave: { title: "Less paperwork. More time for your team.", subtitle: "Keep requests moving and everyone informed.", metric: "Pending requests", value: "3", secondary: "Approved this week", secondValue: "12", heading: "Leave requests", rows: [["AR", "Aditi Rao", "Annual leave · 2 days", "Pending"], ["RK", "Rohan Kumar", "Annual leave · 1 day", "Approved"], ["SP", "Sara Patel", "Personal leave · 1 day", "Approved"]] },
};

export function HrmsLandingHero({ signedIn }: { signedIn: boolean }) {
  const [tab, setTab] = useState<keyof typeof previews>("people");
  const preview = previews[tab];
  return <section className={styles.hero} aria-labelledby="hrms-headline">
    <div className={styles.layout}>
      <div className={styles.copy}>
        <span className={styles.eyebrow}><span /> THE PEOPLE SIDE OF YOUR BUSINESS</span>
        <h1 id="hrms-headline">Great teams.<br />Less busywork.<br /><em>More possibility.</em></h1>
        <p>A thoughtful home for your people operations. Connect employee records, attendance, leave and payroll—so you can focus on the people behind the work.</p>
        <div className={styles.actions}><Link className={styles.primary} href={signedIn ? "/dashboard" : "/register"}>{signedIn ? "Open your dashboard" : "Start your free trial"}<ArrowRight size={18}/></Link><a className={styles.secondary} href="#suite-explorer">Explore HRMS <ArrowUpRight size={17}/></a></div>
        <div className={styles.assurances}><span><Check size={15}/>14-day trial</span><span><Check size={15}/>Employee self-service</span><span><Check size={15}/>Role-based access</span></div>
      </div>
      <div className={styles.preview} aria-label="Interactive HRMS preview with illustrative sample data">
        <div className={styles.previewTop}><span className={styles.brand}><span>C</span> Circuvent HRMS</span><span className={styles.sample}>PRODUCT PREVIEW · SAMPLE DATA</span></div>
        <div className={styles.previewBody}>
          <aside className={styles.previewNav} aria-label="Preview sections"><span className={styles.miniLogo}><LayoutDashboard size={18}/></span>{([['people', Users, 'People'], ['attendance', Clock, 'Attendance'], ['leave', CalendarDays, 'Leave']] as const).map(([id, Icon, label]) => <button key={id} aria-label={`Preview ${label}`} aria-pressed={tab === id} className={tab === id ? styles.selected : ""} onClick={() => setTab(id)}><Icon size={19}/></button>)}<ShieldCheck size={18}/></aside>
          <div className={styles.workspace}>
            <div className={styles.toolbar}><span>Workspace <ChevronRight size={12}/> Overview</span><span><Search size={14}/><Bell size={14}/><b>JD</b></span></div>
            <div className={styles.previewIntro}><span>YOUR WORKSPACE AT A GLANCE</span><h2>{preview.title}</h2><p>{preview.subtitle}</p></div>
            <div className={styles.metrics}><div><span>{preview.metric}<Users size={16}/></span><strong>{preview.value}</strong><small>Illustrative organization</small></div><div><span>{preview.secondary}<CalendarDays size={16}/></span><strong>{preview.secondValue}</strong><small>Everything in one view</small></div></div>
            <div className={styles.roster} aria-live="polite"><h3>{preview.heading}<span>Sample workspace</span></h3>{preview.rows.map(([initials,name,role,status]) => <div className={styles.person} key={name}><span className={styles.avatar}>{initials}</span><span><strong>{name}</strong><small>{role}</small></span><span className={styles.status}>{status}</span></div>)}</div>
            <div className={styles.previewFoot}><ShieldCheck size={15}/><span>People, time and work. Connected.</span></div>
          </div>
        </div>
        <div className={styles.tabs}>{([['people','People directory'],['attendance','Attendance'],['leave','Leave & approvals']] as const).map(([id,label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)} className={tab === id ? styles.activeTab : ""}>{label}</button>)}</div>
      </div>
    </div>
    <div className={styles.journey}><span>EVERY STAGE. ONE WORKSPACE.</span><div>{['Welcome your people','Simplify the everyday','Support their growth','Plan what comes next'].map((label,index) => <a key={label} href="#suite-explorer"><b>0{index+1}</b>{label}<ArrowUpRight size={14}/></a>)}</div></div>
  </section>;
}
