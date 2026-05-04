#!/usr/bin/env node
/**
 * Fix image paths in gown_images table
 * Ensures all paths have proper file extensions
 */

const pg = require('pg')

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL not set')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString })
  
  try {
    await client.connect()
    console.log('✓ Connected to DigitalOcean database')

    // 1. Check current image URLs
    console.log('\n📋 Checking current image URLs...')
    const checkResult = await client.query(`
      SELECT id, gown_id, image_url, is_primary, is_tryon_asset
      FROM gown_images
      WHERE image_url IS NOT NULL
      ORDER BY gown_id, sort_order
    `)
    
    console.log(`Found ${checkResult.rows.length} images\n`)
    
    // Find incomplete paths
    const incompletePaths = checkResult.rows.filter(row => {
      const url = row.image_url
      // Check if URL is missing extension or looks truncated
      return !url.match(/\.(png|jpg|jpeg|gif|webp)$/i)
    })

    if (incompletePaths.length === 0) {
      console.log('✓ All image URLs have proper extensions!')
      process.exit(0)
    }

    console.log(`⚠️  Found ${incompletePaths.length} incomplete paths:\n`)
    incompletePaths.forEach(row => {
      console.log(`  - ID: ${row.id}`)
      console.log(`    URL: "${row.image_url}"`)
      console.log(`    Primary: ${row.is_primary}, Try-on: ${row.is_tryon_asset}\n`)
    })

    // 2. Fix paths - add .png extension if missing
    console.log('🔧 Fixing image paths...\n')
    
    for (const row of incompletePaths) {
      const oldUrl = row.image_url
      let newUrl = oldUrl
      
      // If it looks like a try-on image path without extension, add .png
      if (oldUrl.match(/^\/images\/tryon-\d+$/)) {
        newUrl = oldUrl + '.png'
      } else if (oldUrl.match(/^\/images\/try-on-\d+$/)) {
        newUrl = oldUrl.replace(/^\/images\/try-on-/, '/images/tryon-') + '.png'
      } else if (!oldUrl.match(/\.(png|jpg|jpeg|gif|webp)$/i)) {
        // Default to .png if no extension detected
        newUrl = oldUrl + '.png'
      }

      if (newUrl !== oldUrl) {
        await client.query(
          'UPDATE gown_images SET image_url = $1 WHERE id = $2',
          [newUrl, row.id]
        )
        console.log(`  ✓ Updated: "${oldUrl}" → "${newUrl}"`)
      }
    }

    // 3. Verify fixes
    console.log('\n✓ Image paths have been fixed!')
    console.log('\n📊 Verifying...')
    const verifyResult = await client.query(`
      SELECT id, gown_id, image_url, is_primary, is_tryon_asset
      FROM gown_images
      WHERE image_url IS NOT NULL
      ORDER BY gown_id, sort_order
    `)

    const stillIncomplete = verifyResult.rows.filter(row => {
      const url = row.image_url
      return !url.match(/\.(png|jpg|jpeg|gif|webp)$/i)
    })

    if (stillIncomplete.length === 0) {
      console.log('✓ All ${verifyResult.rows.length} images now have proper extensions!\n')
    } else {
      console.log(`⚠️  ${stillIncomplete.length} paths still need attention`)
      stillIncomplete.forEach(row => console.log(`  - ${row.image_url}`))
    }

  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
