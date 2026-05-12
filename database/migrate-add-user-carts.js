/**
 * Migration: Add user_carts table for mobile cart sync
 * 
 * Run: node database/migrate-add-user-carts.js
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
    console.error('❌ DATABASE_URL not found. Add it to .env.local')
    process.exit(1)
  }

  const client = new Client({
    connectionString: url,
  })

  try {
    await client.connect()
    console.log('✅ Connected to database')

    console.log('\n📋 Adding user_carts table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.user_carts (
        email      citext      PRIMARY KEY,
        items      jsonb       NOT NULL DEFAULT '[]'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_user_carts_email ON public.user_carts(email);
    `)
    console.log('✅ user_carts table created successfully!')

    console.log('\n🎉 Migration complete. Cart sync is now ready.')
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
