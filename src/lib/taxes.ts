// ═══════════════════════════════════════════════════════════
// COUNTRY TAX RULES
// Update rates here as laws change
// ═══════════════════════════════════════════════════════════
export interface TaxRule {
  country: string;
  taxName: string; // e.g. "VAT"
  rate: number; // percentage, e.g. 18
}

export const TAX_RULES: TaxRule[] = [
  { country: 'Uganda', taxName: 'VAT', rate: 18 },
  { country: 'Kenya', taxName: 'VAT', rate: 16 },
  { country: 'Tanzania', taxName: 'VAT', rate: 18 },
  { country: 'Rwanda', taxName: 'VAT', rate: 18 },
  { country: 'Burundi', taxName: 'VAT', rate: 18 },
  { country: 'South Sudan', taxName: 'VAT', rate: 18 },
  { country: 'DR Congo', taxName: 'VAT', rate: 16 },
  { country: 'Ethiopia', taxName: 'VAT', rate: 15 },
  { country: 'Somalia', taxName: 'Sales Tax', rate: 10 },
  { country: 'Djibouti', taxName: 'VAT', rate: 10 },
  { country: 'United Arab Emirates', taxName: 'VAT', rate: 5 },
];

export function getTaxRule(country: string): TaxRule | null {
  if (!country) return null;
  const normalized = country.trim().toLowerCase();
  return (
    TAX_RULES.find((r) => r.country.toLowerCase() === normalized) || null
  );
}