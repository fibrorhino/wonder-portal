"use client";

// Data-use notice attached to every control that sends a query to CDC WONDER.
//
// The official WONDER web portal makes you tick "I agree" against its Data Use
// Restrictions before it will run anything; our API call passes
// `accept_datause_restrictions=true` on the user's behalf, so the same terms
// have to be visible here. Each query control carries a footnote marker that
// opens the summary below and links to the authoritative CDC page.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const DATA_USE_URL = "https://wonder.cdc.gov/datause.html";

/** Superscript marker to place inside a button that runs a WONDER query. */
export function DataUseMark() {
  return (
    <sup aria-hidden="true" className="ml-0.5 text-[0.9em] leading-none">
      *
    </sup>
  );
}

/**
 * The footnote line that explains the marker. Place it directly under the
 * control it annotates.
 */
export function DataUseFootnote({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <p className={`text-[11px] leading-snug text-slate-500 ${className}`}>
        <span aria-hidden="true">*</span> Running a query submits it to CDC
        WONDER. By doing so you agree to the{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700"
        >
          CDC WONDER Data Use Restrictions
        </button>
        .
      </p>
      <DataUseDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Plain link, for the footer. */
export function DataUseLink({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700"
      >
        {children ?? "CDC WONDER Data Use Restrictions"}
      </button>
      <DataUseDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function DataUseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  // The markers sit inside paragraphs, and a <dialog> inside a <p> is invalid
  // HTML that the browser reparents — which breaks hydration. Rendering into
  // document.body sidesteps the nesting entirely.
  //
  // Nothing is rendered while closed, which also means the portal only runs in
  // response to a click: no window access during the server render, and no
  // mount flag needed to keep the two in agreement.
  useEffect(() => {
    const el = ref.current;
    // showModal() is what gives us the backdrop, focus trap and Esc-to-close.
    if (el && !el.open) el.showModal();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself, outside the panel)
        // closes it.
        if (e.target === ref.current) onClose();
      }}
      // m-auto: Tailwind's preflight zeroes the margin that normally centres a
      // modal <dialog>, which otherwise pins it to the top-left corner.
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="max-h-[80vh] overflow-y-auto p-6 text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">
          CDC WONDER Data Use Restrictions
        </h2>
        <p className="mt-3 text-sm">
          This site queries the CDC WONDER online database on your behalf. CDC
          requires everyone who uses these data to accept the following terms,
          summarized here:
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
          <li>
            Use the data for <strong>statistical reporting and analysis only</strong>.
          </li>
          <li>
            Do not present or publish statistics representing{" "}
            <strong>nine or fewer deaths</strong>, including rates based on
            counts of nine or fewer deaths, in figures, graphs, maps or tables.
          </li>
          <li>
            Make no attempt to learn the identity of any person or establishment
            included in the data, and do not link these data with other datasets
            for the purpose of identifying an individual.
          </li>
          <li>
            If you inadvertently discover an individual&rsquo;s identity, make no
            disclosure or other use of it, and report the discovery to the NCHS
            Confidentiality Officer.
          </li>
        </ul>
        <p className="mt-3 text-sm">
          These terms come from the Public Health Service Act (42 U.S.C.
          242m(d)) and the CDC/ATSDR Policy on Releasing and Sharing Data. The
          summary above is provided for convenience — the authoritative text is
          on the CDC site.
        </p>
        <p className="mt-3 text-sm">
          <a
            href={DATA_USE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-600 hover:underline"
          >
            Read the full CDC WONDER Data Use Restrictions ↗
          </a>
        </p>
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          This site is an independent tool. It is not affiliated with, operated
          by, or endorsed by the Centers for Disease Control and Prevention.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
