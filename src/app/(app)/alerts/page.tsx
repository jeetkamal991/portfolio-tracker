import { handleAlertSnapshot, handleAlertsList, type AlertSnapshot } from "@/lib/api/alerts";
import { getRepo, telegramConfigured } from "@/lib/api/server";
import { AlertForm } from "../../components/alerts/AlertForm";
import { AlertBriefing } from "../../components/alerts/AlertBriefing";
import { RulesList } from "../../components/alerts/RulesList";
import { istDate } from "@/lib/time/ist";
import { fmtDate } from "@/lib/view/dashboard";
import { Panel } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: newKey } = await searchParams;
  const repo = getRepo();
  const [{ body: data }, prefill] = await Promise.all([
    handleAlertsList(repo, telegramConfigured()),
    newKey ? handleAlertSnapshot(repo, newKey) : null,
  ]);
  const initial = prefill?.status === 200 ? (prefill.body as AlertSnapshot) : null;

  return (
    <div className="flex flex-col gap-4">
      {data.telegram !== "connected" && (
        <Panel className="border-[color-mix(in_srgb,var(--warn)_40%,transparent)]">
          <p className="text-sm text-[var(--warn)]">
            Telegram not connected — alerts show here only. Run <code className="font-mono">npm run telegram-setup</code> and add the two settings to Vercel.
          </p>
        </Panel>
      )}
      <AlertBriefing data={data} today={fmtDate(istDate(new Date()))} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AlertForm key={initial?.key ?? ""} initial={initial} />
        <RulesList rules={data.rules} />
      </div>
    </div>
  );
}
