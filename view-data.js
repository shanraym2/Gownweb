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
  const client = new Client({ connectionString: url })

  try {
    await client.connect()
    
    console.log('\n===============================================')
    console.log('           YOUR GOWNS IN DIGITALOCEAN')
    console.log('===============================================\n')
    
    const { rows: gowns } = await client.query(
      'SELECT id, name, sale_price, color, silhouette, is_active FROM gowns LIMIT 10'
    )
    
    if (gowns.length === 0) {
      console.log('❌ No gowns found')
    } else {
      console.log(`📦 Total Gowns: ${gowns.length}\n`)
      gowns.forEach((gown, idx) => {
        console.log(`${idx + 1}. ${gown.name}`)
        console.log(`   ID: ${gown.id}`)
        console.log(`   Price: ₱${Number(gown.sale_price).toLocaleString()}`)
        console.log(`   Color: ${gown.color || 'N/A'}`)
        console.log(`   Silhouette: ${gown.silhouette || 'N/A'}`)
        console.log(`   Active: ${gown.is_active ? '✅ Yes' : '❌ No'}`)
        console.log()
      })
    }

    console.log('===============================================')
    console.log('           YOUR ORDERS IN DIGITALOCEAN')
    console.log('===============================================\n')
    
    const { rows: orders } = await client.query(
      'SELECT id, order_number, customer_email, total, status, placed_at FROM orders LIMIT 10'
    )
    
    if (orders.length === 0) {
      console.log('❌ No orders found')
    } else {
      console.log(`📋 Total Orders: ${orders.length}\n`)
      orders.forEach((order, idx) => {
        console.log(`${idx + 1}. Order ${order.order_number}`)
        console.log(`   Customer: ${order.customer_email}`)
        console.log(`   Total: ₱${Number(order.total).toLocaleString()}`)
        console.log(`   Status: ${order.status}`)
        console.log(`   Date: ${new Date(order.placed_at).toLocaleDateString()}`)
        console.log()
      })
    }

    console.log('===============================================\n')
  } catch (err) {
    console.error('❌ Error:', err.message)
  } finally {
    await client.end()
  }
}

main()
