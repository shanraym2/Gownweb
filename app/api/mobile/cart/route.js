/**
 * POST/GET /api/mobile/cart
 * ────────────────────────────
 * Fetch and save user's cart from/to backend database
 * Syncs across all devices (mobile, web, etc)
 */

import { query } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ── GET ────────────────────────────────────────────────────────────────

export async function GET(request) {
  try {
    const sessionUser = await getAuthenticatedUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const userEmail = sessionUser.email;

    const rows = await query(
      `SELECT items, updated_at FROM user_carts WHERE LOWER(email) = LOWER($1)`,
      [userEmail]
    );

    if (rows.length === 0) {
      return NextResponse.json({
        items: [],
        lastUpdated: new Date().toISOString(),
      });
    }

    const cart = rows[0];
    return NextResponse.json({
      items: cart.items || [],
      lastUpdated: cart.updated_at,
    });
  } catch (err) {
    console.error('Error fetching cart:', err);
    return NextResponse.json({ error: 'Failed to fetch cart' }, { status: 500 });
  }
}

// ── POST ───────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const sessionUser = await getAuthenticatedUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const userEmail = sessionUser.email;

    const body = await request.json();
    const { items } = body;

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'Items must be an array' }, { status: 400 });
    }

    // Validate items format: each item should have id and qty
    const validItems = items.filter((item) => item.id && typeof item.qty === 'number');

    // Upsert cart
    const rows = await query(
      `INSERT INTO user_carts (email, items, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (email) DO UPDATE SET
         items = $2,
         updated_at = NOW()
       RETURNING items, updated_at`,
      [userEmail.toLowerCase(), JSON.stringify(validItems)]
    );

    const cart = rows[0];
    return NextResponse.json({
      ok: true,
      items: cart.items || [],
      syncedAt: cart.updated_at,
    });
  } catch (err) {
    console.error('Error saving cart:', err);
    return NextResponse.json({ error: 'Failed to save cart' }, { status: 500 });
  }
}
