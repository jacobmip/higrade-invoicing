// ─── Backup / restore helpers ────────────────────────────────────────────────
//
// Exports every row from every table into a single JSON document, and can
// import it back. The format is portable Postgres-shape JSON (server column
// names, not UI shape) so it remains useful if we migrate off Supabase to a
// self-hosted Postgres NAS later.
//
// The backup also includes a schemaVersion so future restorers can transform
// older snapshots into the current schema.

import { supabase } from './supabase.js'

export const BACKUP_SCHEMA_VERSION = 1

const TABLES = [
  'clients',
  'invoices',
  'invoice_items',
  'payments',
  'saved_items',
  'expenses',
  'settings',
  'invoice_versions',
  'invoice_events',
]

// Pull every row from every table. Returns { schemaVersion, exportedAt, tables: { name: rows[] } }.
const PAGE = 1000

// Read one table completely, a page at a time.
//
// A bare .select('*') silently returns only the first 1,000 rows, which is
// Supabase's default ceiling, and reports no error. invoice_items alone holds
// over 1,900 rows, so an unpaginated export dropped roughly 900 line items
// while appearing to succeed — and importBackup's 'replace' mode deletes every
// row before inserting the file, so restoring such a backup destroyed the data
// it was supposed to protect. The nightly job in AI-OS/scripts/backup-supabase.js
// has always paged correctly; this is the in-app export catching up.
async function selectAllRows(table) {
  const rows = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(offset, offset + PAGE - 1)
    if (error) return { rows: null, error }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return { rows, error: null }
  }
}

export async function exportAll() {
  const tables = {}
  for (const t of TABLES) {
    const { rows, error } = await selectAllRows(t)
    if (error) {
      // Some tables (invoice_versions, invoice_events) may not exist in older
      // installs. Don't abort — just skip and continue.
      console.warn(`backup: skipping table "${t}":`, error.message)
      tables[t] = []
      continue
    }
    tables[t] = rows || []
  }
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: 'higrade-invoicing',
    tables,
  }
}

// Trigger a browser download of the export as a JSON file.
export async function downloadBackup() {
  const data = await exportAll()
  const stamp = data.exportedAt.replace(/[:.]/g, '-').slice(0, 19) // 2026-04-30T08-43-00
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `higrade-backup-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { rows: countRows(data), bytes: blob.size, exportedAt: data.exportedAt }
}

// Sum the number of rows across all tables (for the post-export message).
function countRows(snapshot) {
  return Object.values(snapshot.tables).reduce((s, rows) => s + rows.length, 0)
}

// Restore mode:
// - "merge"   : upsert by primary key, leaves rows that aren't in the backup alone
// - "replace" : DELETE all current rows in each table first, then insert
//
// Returns { restored: { table: count }, errors: [{ table, message }] }
export async function importBackup(snapshot, { mode = 'merge' } = {}) {
  if (!snapshot || !snapshot.tables) throw new Error('Invalid backup file')
  if (snapshot.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error(`Backup is from a newer version of the app (v${snapshot.schemaVersion}). Update before restoring.`)
  }
  // Order matters: delete children before parents, insert parents before children.
  const insertOrder = [
    'clients',
    'saved_items',
    'expenses',
    'settings',
    'invoices',
    'invoice_items',
    'payments',
    'invoice_versions',
    'invoice_events',
  ]
  const deleteOrder = [...insertOrder].reverse()

  const restored = {}
  const errors = []

  if (mode === 'replace') {
    // A snapshot written by the old unpaginated exportAll has exactly 1,000 rows
    // in a table that really had more. Replacing from one of those deletes
    // everything and restores a truncated copy, so refuse rather than destroy.
    const suspect = Object.entries(snapshot.tables || {})
      .filter(([, rows]) => Array.isArray(rows) && rows.length === PAGE)
      .map(([t]) => t)
    if (suspect.length) {
      return {
        restored: {},
        errors: [{
          table: suspect.join(', '),
          message:
            `Refusing to replace: ${suspect.join(', ')} holds exactly ${PAGE} rows, which ` +
            `means this backup was written before export pagination was fixed and is ` +
            `probably truncated. Use merge mode, or take a fresh export first.`,
        }],
      }
    }
    for (const t of deleteOrder) {
      // Use a non-null filter that always matches every row (id IS NOT NULL).
      // Supabase requires a where clause on delete().
      const { error } = await supabase.from(t).delete().not('id', 'is', null)
      if (error) errors.push({ table: t, message: `delete: ${error.message}` })
    }
  }

  for (const t of insertOrder) {
    const rows = snapshot.tables[t]
    if (!rows || rows.length === 0) { restored[t] = 0; continue }
    const { error } = await supabase.from(t).upsert(rows)
    if (error) {
      errors.push({ table: t, message: error.message })
      restored[t] = 0
    } else {
      restored[t] = rows.length
    }
  }

  return { restored, errors }
}

// Read a File (from a <input type="file">) and parse JSON.
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      try { resolve(JSON.parse(r.result)) }
      catch (e) { reject(new Error('File is not valid JSON')) }
    }
    r.onerror = () => reject(new Error('Could not read file'))
    r.readAsText(file)
  })
}
