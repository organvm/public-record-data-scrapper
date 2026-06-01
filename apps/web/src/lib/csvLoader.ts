import Papa from 'papaparse'

export async function loadProspects() {
  const res = await fetch('/ucc_enriched.csv')
  const text = await res.text()

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h: string) => h.trim(),
    transform: (v: unknown) => (typeof v === 'string' ? v.trim() : v)
  })

  return parsed.data
}
