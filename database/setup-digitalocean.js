/**
 * Sets up a DigitalOcean PostgreSQL database: runs schema and seeds gowns.
 * Your DigitalOcean database already exists, we just need to create tables.
 *
 * Prerequisites:
 * 1. .env.local must have your DigitalOcean DATABASE_URL
 * 2. Run: node database/setup-digitalocean.js
 */

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
    console.error('❌ DATABASE_URL not found. Add it to .env.local:')
    console.error('   DATABASE_URL=postgresql://doadmin:password@host:port/defaultdb?sslmode=require')
    process.exit(1)
  }

  const client = new Client({
    connectionString: url,
  })

  try {
    console.log('🔗 Connecting to DigitalOcean PostgreSQL...')
    await client.connect()
    console.log('✅ Connected successfully!')

    console.log('\n📋 Running schema.sql...')
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
    await client.query(schema)
    console.log('✅ Schema created successfully!')

    console.log('\n🌱 Seeding sample gowns...')
    const seed = readFileSync(join(__dirname, 'seed-gowns.sql'), 'utf8')
    await client.query(seed)
    console.log('✅ Sample data seeded successfully!')

    // Verify tables
    const { rows: tables } = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `)
    console.log('\n📊 Tables created:', tables.map((t) => t.tablename).join(', '))
    console.log('\n🎉 Done! Your DigitalOcean database is ready.')
    console.log('   All data (gowns, orders, users) will now persist to DigitalOcean.')
  } catch (err) {
    console.error('\n❌ Setup failed:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
