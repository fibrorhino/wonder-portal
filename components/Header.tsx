"use client";

// App header: JHU Center for Suicide Prevention logo (links out to the center)
// plus the WONDER Portal title. The logo is loaded from /logo.png; if that file
// isn't present yet it falls back to a clean text wordmark so nothing looks broken.

import { useState } from "react";

const CENTER_URL = "https://publichealth.jhu.edu/center-for-suicide-prevention";

export default function Header() {
  const [logoOk, setLogoOk] = useState(true);

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <a
          href={CENTER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center"
          title="Johns Hopkins Center for Suicide Prevention"
        >
          {logoOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/logo.png"
              alt="Johns Hopkins Bloomberg School of Public Health — Center for Suicide Prevention"
              className="h-20 w-auto"
              onError={() => setLogoOk(false)}
            />
          ) : (
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight" style={{ color: "#002D72" }}>
                Johns Hopkins Bloomberg School of Public Health
              </span>
              <span className="text-xs font-semibold" style={{ color: "#002D72" }}>
                Center for Suicide Prevention
              </span>
            </span>
          )}
        </a>

        <div className="ml-auto flex flex-col items-end text-right">
          <h1 className="text-lg font-bold text-slate-900">WONDER Portal</h1>
          <p className="text-xs text-slate-500">
            Query, analyze &amp; visualize CDC WONDER mortality data
          </p>
        </div>
      </div>
    </header>
  );
}
