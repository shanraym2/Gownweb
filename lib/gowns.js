/**
 * Map a DB gown row (with joined image) to API response shape.
 * The query must JOIN gown_images and alias columns as shown below:
 *
 *   SELECT g.*, gi.image_url, gi.alt
 *   FROM gowns g
 *   LEFT JOIN gown_images gi ON gi.gown_id = g.id AND gi.is_primary = TRUE
 */
export function rowToGown(row) {
  if (!row) return null
  return {
    id:          row.id,
    name:        row.name,
    price:       '₱' + Number(row.sale_price).toLocaleString('en-PH'),
    image:       row.image_url  || '',
    alt:         row.alt        || row.name,
    color:       row.color      || '',
    silhouette:  row.silhouette || '',
    fabric:      row.fabric     || '',
    neckline:    row.neckline   || '',
    description: row.description || '',
    isActive:    row.is_active  ?? true,
  }
}