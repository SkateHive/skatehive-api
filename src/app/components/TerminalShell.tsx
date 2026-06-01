import type { ReactNode } from "react";
import Nav, { type Tab } from "./Nav";

/**
 * Shared terminal-window chrome used across the rendered pages.
 * Styling lives in globals.css (the `t-*` classes).
 */
export default function TerminalShell({
  title,
  command,
  active,
  right,
  children,
}: {
  title: string;
  command: string;
  active: Tab;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="t-wrapper">
      <div className="t-shell">
        <Nav active={active} />

        <div className="t-window">
          <div className="t-titlebar">
            <span className="t-dots">
              <i className="t-d red" />
              <i className="t-d yellow" />
              <i className="t-d green" />
            </span>
            <span className="t-titletext">{title}</span>
            {right && <span className="t-titleright">{right}</span>}
          </div>

          <div className="t-terminal">
            <p className="t-prompt">
              <span className="t-user">root@skatehive</span>
              <span className="t-path">:~/services</span>
              <span className="t-dollar">$</span>{" "}
              <span className="t-cmd">{command}</span>
            </p>
          </div>
        </div>

        {children}

        <footer className="t-foot">
          <span>skatehive.app // api console</span>
          <span className="t-cursor">_</span>
        </footer>
      </div>
    </div>
  );
}
