const { Client } = require('pg')
const { readFileSync } = require('fs')
const { join } = require('path')

function loadEnv() {
  try {
    const envPath = join(process.cwd(), '.env.local')
    const content = readFileSync(envPath, 'utf8')
    const match = content.match(/DATABASE_URL=(.+)/)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  } catch {}
  return process.env.DATABASE_URL
}

async function main() {
  const url = loadEnv()
  if (!url) {
    console.error('❌ DATABASE_URL not found in .env.local')
    process.exit(1)
  }

  const client = new Client({ connectionString: url })

  try {
    console.log('🔗 Connecting to DigitalOcean PostgreSQL...')
    await client.connect()
    console.log('✅ Connected successfully!')

    // Check tables
    const { rows: tables } = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `)
    console.log('\n📊 Existing tables:', tables.map((t) => t.tablename).join(', '))

    // Check if gowns table has data
    const { rows: gownsCount } = await client.query('SELECT COUNT(*) as count FROM gowns')
    console.log(`\n📦 Gowns in database: ${gownsCount[0].count}`)

    // Check if orders table exists
    const { rows: ordersCount } = await client.query('SELECT COUNT(*) as count FROM orders')
    console.log(`📋 Orders in database: ${ordersCount[0].count}`)

    console.log('\n✨ Your DigitalOcean database is ready to use!')
    console.log('   All data will persist when you add gowns or create orders.')
  } catch (err) {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
