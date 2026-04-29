export interface Vendor {
  rank: number
  name: string
  totalValue: string
  contractCount: string
}

export interface ConcentrationResult {
  department: string
  hhi: number
  band: 'HIGH' | 'MODERATE' | 'LOW'
}

export interface Stat {
  label: string
  value: string
}

export interface DashboardMetrics {
  total_contracts: number
  total_spend: number
  unique_vendors: number
}

export interface SpendByYear {
  year: number
  total_spend: number
}

export interface ConcentrationTrendPoint {
  year: number
  department: string
  hhi: number
}

export interface VendorCompetitionPoint {
  year: number
  new_spend: number
  returning_spend: number
  new_count: number
  returning_count: number
}

export interface ConcentrationScatterPoint {
  department: string
  hhi: number
  band: 'HIGH' | 'MODERATE' | 'LOW'
  total_spend: number
  vendor_count: number
}

export interface VendorDominancePoint {
  department: string
  total_spend: number
  top_vendor: string
  vendor_spend: number
  dominance_pct: number
}

export interface ContractDistributionBucket {
  bucket_id: number
  bucket: string
  contract_count: number
  total_amount: number
}
