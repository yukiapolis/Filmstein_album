#!/usr/bin/env node
import { randomBytes, scryptSync } from 'node:crypto'

const password = process.argv[2]
if (!password) {
  console.error('Usage: node scripts/hash-admin-password.mjs <password>')
  process.exit(1)
}

const N = 16384
const r = 8
const p = 1
const keyLength = 64
const salt = randomBytes(16)
const derived = scryptSync(password, salt, keyLength, { N, r, p })

console.log(['scrypt', String(N), String(r), String(p), salt.toString('base64url'), derived.toString('base64url')].join('$'))
