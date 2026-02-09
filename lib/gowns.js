/** Map DB gown row to API response shape (id, name, price, image, alt, type, color, silhouette, description, style) */
export function rowToGown(row) {
  if (!row) return null
  const style = row.style
    ? typeof row.style === 'string'
      ? (() => {
          try {
            return JSON.parse(row.style)
          } catch {
            return null
          }
        })()
      : row.style
    : null
  return {
    id: row.id,
    name: row.name,
    price: row.price_display || '₱' + Number(row.price_amount).toLocaleString('en-PH'),
    image: row.image || '',
    alt: row.alt || row.name,
    type: row.type || 'Gowns',
    color: row.color || '',
    silhouette: row.silhouette || '',
    description: row.description || '',
    ...(style && typeof style === 'object' ? { style } : {}),
  }
}
