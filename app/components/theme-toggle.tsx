"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
      document.cookie = "theme=dark; path=/; max-age=31536000; samesite=lax";
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
      document.cookie = "theme=light; path=/; max-age=31536000; samesite=lax";
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--c-fg)" }}>Dark mode</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--c-muted)" }}>Switch between light and dark theme</p>
      </div>
      <button
        type="button"
        onClick={toggle}
        role="switch"
        aria-checked={dark}
        className="relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none"
        style={{ background: dark ? "#4f46e5" : "#d1d5db" }}
      >
        <span className="sr-only">Toggle dark mode</span>
        <span
          className="inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out"
          style={{
            transform: dark ? "translateX(22px)" : "translateX(2px)",
            marginTop: "2px",
          }}
        />
      </button>
    </div>
  );
}
