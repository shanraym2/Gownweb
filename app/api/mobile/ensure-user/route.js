import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import bcrypt from "bcryptjs";

const USE_DB = process.env.USE_DB === "true";
const dataFile = path.join(process.cwd(), "data", "users.json");

// Simple per-IP rate limiter — this route no longer requires an admin
// secret (it's a normal "find or create my account" operation triggered
// by ordinary mobile app users, not an admin action), so it needs its own
// abuse control instead.
const rateLimitMap = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

function checkRateLimit(request) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_REQUESTS;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function splitName(rawName, email) {
  const fallback = String(email || "").split("@")[0] || "Customer";
  const clean = String(rawName || "").trim().replace(/\s+/g, " ");
  if (!clean) return { firstName: fallback, lastName: "Customer" };
  const parts = clean.split(" ");
  return {
    firstName: parts[0] || fallback,
    lastName: parts.slice(1).join(" ") || "Customer",
  };
}

function loadUsers() {
  if (!fs.existsSync(dataFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(users, null, 2));
}

export async function POST(request) {
  if (!checkRateLimit(request)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  const name = String(body?.name || "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "Valid email required" }, { status: 400 });
  }

  if (!USE_DB) {
    const users = loadUsers();
    const existing = users.find((u) => normalizeEmail(u?.email) === email);
    if (existing?.id) {
      return NextResponse.json({ ok: true, userId: String(existing.id), existing: true });
    }
    const names = splitName(name, email);
    const fakePasswordHash = await bcrypt.hash(`${email}-${Date.now()}`, 10);
    const newUser = {
      id: String(Date.now()),
      firstName: names.firstName,
      lastName: names.lastName,
      name: `${names.firstName} ${names.lastName}`.trim(),
      email,
      passwordHash: fakePasswordHash,
      role: "customer",
      createdAt: new Date().toISOString(),
    };
    saveUsers([...users, newUser]);
    return NextResponse.json({ ok: true, userId: String(newUser.id), existing: false });
  }

  try {
    const { query } = await import("@/lib/db");
    const found = await query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
    if (found.length > 0) {
      return NextResponse.json({ ok: true, userId: String(found[0].id), existing: true });
    }

    const names = splitName(name, email);
    const passwordHash = await bcrypt.hash(`${email}-${Date.now()}`, 10);
    const created = await query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'customer')
       RETURNING id`,
      [names.firstName, names.lastName, email, passwordHash]
    );
    return NextResponse.json({ ok: true, userId: String(created[0].id), existing: false });
  } catch (err) {
    console.error("POST /api/mobile/ensure-user error:", err);
    return NextResponse.json({ ok: false, error: "Failed to resolve user" }, { status: 500 });
  }
}
