import { MetricsSummary } from '@/components/dashboard/MetricsSummary'
import { ConcentrationMethodology } from '@/components/dashboard/ConcentrationMethodology'
import { TopVendorsChart } from '@/components/dashboard/TopVendorsChart'
import { ConcentrationChart } from '@/components/dashboard/ConcentrationChart'
import { SpendOverTimeChart } from '@/components/dashboard/SpendOverTimeChart'
import { ConcentrationScatterChart } from '@/components/dashboard/ConcentrationScatterChart'
import { VendorDominanceChart } from '@/components/dashboard/VendorDominanceChart'
import { VendorCompetitionChart } from '@/components/dashboard/VendorCompetitionChart'
import { ThresholdDistributionChart } from '@/components/dashboard/ThresholdDistributionChart'

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4">
      <span
        className="text-[10px] font-bold uppercase tracking-[0.18em] whitespace-nowrap shrink-0"
        style={{ color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-syne)' }}
      >
        {label}
      </span>
      <div className="h-px flex-1" style={{ backgroundColor: 'hsl(var(--border))' }} />
    </div>
  )
}

export default function DashboardPage() {
  return (
    <div className="w-full">

      {/* ── Hero block — header + KPIs + methodology ── */}
      <div className="space-y-8">
        <div className="relative pl-5">
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full"
            style={{ backgroundColor: 'hsl(var(--primary))' }}
          />
          <div
            className="text-[9px] font-bold tracking-[0.22em] uppercase mb-3"
            style={{ color: 'hsl(var(--primary))', fontFamily: 'var(--font-syne)' }}
          >
            Government of Alberta · Open Contract Data
          </div>
          <h1
            className="text-4xl font-bold tracking-tight text-foreground"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Vendor Concentration
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Alberta government contracts — identifying supplier dominance and competition displacement
          </p>
        </div>

        <MetricsSummary />
        <ConcentrationMethodology />
      </div>

      {/* ── Chart sections — more generous spacing ── */}
      <div className="mt-16 space-y-14">

        <section className="space-y-6">
          <SectionDivider label="Spending Breakdown" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <TopVendorsChart />
            <ConcentrationChart />
          </div>
        </section>

        <section className="space-y-6">
          <SectionDivider label="Trends & Risk Profile" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <SpendOverTimeChart />
            <ConcentrationScatterChart />
          </div>
        </section>

        <section className="space-y-6">
          <SectionDivider label="Competition & Distribution" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <VendorCompetitionChart />
            <ThresholdDistributionChart />
          </div>
        </section>

        <section className="space-y-6">
          <SectionDivider label="Ministry Dominance" />
          <VendorDominanceChart />
        </section>

      </div>
    </div>
  )
}
