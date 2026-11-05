// Shown the instant a tab is clicked while the next page's data loads. Next keeps the header, tabs and status strip on
// screen and swaps only this area, so a click always gives visible feedback instead of a frozen page.
export default function Loading() {
  const bar = "animate-pulse rounded bg-slate-800/70";
  return (
    <div aria-busy="true" aria-label="Loading page" role="status" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className={`${bar} mb-4 h-4 w-40`} />
          <div className={`${bar} h-[320px] w-full`} />
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className={`${bar} mb-4 h-4 w-32`} />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className={`${bar} h-6 w-full`} />)}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className={`${bar} mb-4 h-4 w-48`} />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className={`${bar} h-8 w-full`} />)}
        </div>
      </div>
    </div>
  );
}
