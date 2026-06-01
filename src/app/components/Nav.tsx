import Link from "next/link";

export type Tab = "docs" | "leaderboard" | "status" | "stack";

export const NAV_TABS: { id: Tab; href: string; label: string }[] = [
  { id: "docs", href: "/", label: "~/docs" },
  { id: "leaderboard", href: "/leaderboard", label: "~/leaderboard" },
  { id: "status", href: "/status", label: "~/status" },
  { id: "stack", href: "/stack", label: "~/stack" },
];

/**
 * Canonical navigation shared across every page. Styling lives in globals.css
 * (the `t-nav` / `t-tab` classes) so the nav looks identical everywhere.
 */
export default function Nav({ active }: { active: Tab }) {
  return (
    <nav className="t-nav">
      {NAV_TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={`t-tab ${tab.id === active ? "is-active" : ""}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
