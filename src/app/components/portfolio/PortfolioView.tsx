"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import type { Holding, StoredDay } from "@/lib/db/types";
import { buildPortfolioView } from "@/lib/view/portfolio";
import { useQuotes } from "../QuotesProvider";
import { HoldingForm } from "./HoldingForm";
import { HoldingsTable } from "./HoldingsTable";
import { SummaryCards } from "./SummaryCards";
import { WarningsBar } from "./WarningsBar";

/*
 * The form is driven by the URL so other tabs can deep-link into it: ?add=1 (empty add form),
 * ?add=KEY (stock pre-picked), ?edit=KEY (edit; falls back to add when KEY is not held).
 * Like the stock pop-up, it is opened and closed with the History API, which the App Router
 * syncs into useSearchParams without re-rendering the force-dynamic page on the server.
 */
function setParams(pathname: string, change: (p: URLSearchParams) => void) {
  const params = new URLSearchParams(window.location.search);
  change(params);
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
}

export function PortfolioView({
  holdings,
  latest,
  today,
}: {
  holdings: Holding[];
  latest: [number, StoredDay | null][];
  today: string;
}) {
  const { quotes, open } = useQuotes();
  const pathname = usePathname() ?? "/portfolio";
  const params = useSearchParams();
  const opener = useRef<HTMLElement | null>(null);

  const view = buildPortfolioView(holdings, new Map(latest), quotes, today);

  const addParam = params?.get("add") ?? null;
  const editParam = params?.get("edit") ?? null;
  const formKey = editParam ? `edit:${editParam}` : addParam ? `add:${addParam}` : null;
  const editing = editParam ? holdings.find((h) => h.key === editParam) : undefined;
  const mode: "add" | "edit" = editing ? "edit" : "add";
  const initialKey = editParam ?? (addParam && addParam !== "1" ? addParam : null);

  const openAdd = (el: HTMLElement) => {
    opener.current = el;
    setParams(pathname, (p) => {
      p.delete("edit");
      p.set("add", "1");
    });
  };
  const openEdit = (key: string, el: HTMLElement) => {
    opener.current = el;
    setParams(pathname, (p) => {
      p.delete("add");
      p.set("edit", key);
    });
  };
  const close = () =>
    setParams(pathname, (p) => {
      p.delete("add");
      p.delete("edit");
    });

  return (
    <div className="flex flex-col gap-4">
      <SummaryCards totals={view.totals} live={open && view.totals.count - view.totals.unpriced > 0} />
      <WarningsBar warnings={view.warnings} />
      <HoldingsTable rows={view.rows} onAdd={openAdd} onEdit={openEdit} />
      {formKey && (
        <HoldingForm
          key={formKey}
          mode={mode}
          initialKey={initialKey}
          holdings={holdings}
          opener={opener.current}
          onClose={close}
        />
      )}
    </div>
  );
}
