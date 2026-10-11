/** "17 Mar 2023" from a FHIR date or dateTime. Partial dates keep their precision. */
export function formatDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  if (!m) return String(y)
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  })
  return d ? `${d} ${month} ${y}` : `${month} ${y}`
}
