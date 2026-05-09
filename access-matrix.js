/**
 * AuditGlide — Access Control Matrix
 *
 * Generates a matrix of screens/buttons vs access flags derived from the
 * login response. Run with:  node access-matrix.js
 *
 * Outputs:
 *   - Formatted table to stdout
 *   - access-matrix.csv in the same directory
 */

const fs   = require('fs');
const path = require('path');

// ─── Column definitions ────────────────────────────────────────────────────────
// Each column maps to one sub-permission in the LoginResponse.access object.

const COLUMNS = [
  // RWD modules
  'userMgmt.read',
  'userMgmt.write',
  'userMgmt.delete',
  'branchMgmt.read',
  'branchMgmt.write',
  'branchMgmt.delete',
  'clientMgmt.read',
  'clientMgmt.write',
  'clientMgmt.delete',
  'complianceMgmt.read',
  'complianceMgmt.write',
  'complianceMgmt.delete',
  'caseMgmt.read',
  'caseMgmt.write',
  'caseMgmt.delete',
  'teamMgmt.read',
  'teamMgmt.write',
  'teamMgmt.delete',
  // Binary modules (single access flag)
  'workAllocation.access',
  'verifyCases.access',
  'workOnCases.access',
  'dashboard.access',
];

// ─── Row definitions ───────────────────────────────────────────────────────────
// flags: array of COLUMNS values that gate this screen/button.
// For OR conditions (any one flag is sufficient), all applicable flags are listed.
// For AND conditions, all required flags are listed.
// The note field documents OR vs AND where it matters.

const ROWS = [
  // ── Screens (navigation-level gates) ──────────────────────────────────────
  {
    category: 'Screen',
    screen: 'Dashboard page',
    flags: ['dashboard.access'],
  },
  {
    category: 'Screen',
    screen: 'My To-Do page',
    flags: ['workOnCases.access', 'verifyCases.access'],
    note: 'OR — visible if either flag is true',
  },
  {
    category: 'Screen',
    screen: 'Cases List page',
    flags: ['caseMgmt.read'],
  },
  {
    category: 'Screen',
    screen: 'Closed Cases page',
    flags: ['caseMgmt.read'],
  },
  {
    category: 'Screen',
    screen: 'Verify Queue page',
    flags: ['verifyCases.access'],
  },
  {
    category: 'Screen',
    screen: 'Work Allocation page',
    flags: ['workAllocation.access'],
  },
  {
    category: 'Screen',
    screen: 'Clients List page',
    flags: ['clientMgmt.read'],
  },
  {
    category: 'Screen',
    screen: 'Compliance List page',
    flags: ['complianceMgmt.read'],
  },
  {
    category: 'Screen',
    screen: 'Branches List page',
    flags: ['branchMgmt.read'],
  },
  {
    category: 'Screen',
    screen: 'Branch New page (redirect gate)',
    flags: ['branchMgmt.write'],
  },
  {
    category: 'Screen',
    screen: 'Users List page',
    flags: ['userMgmt.read'],
  },
  {
    category: 'Screen',
    screen: 'User Invite page (redirect gate)',
    flags: ['userMgmt.write'],
  },
  {
    category: 'Screen',
    screen: 'Teams List page',
    flags: ['teamMgmt.read'],
  },

  // ── Cases ──────────────────────────────────────────────────────────────────
  {
    category: 'Case',
    screen: 'Add Case button',
    flags: ['caseMgmt.write'],
  },
  {
    category: 'Case',
    screen: 'Case list — Client filter visible',
    flags: ['clientMgmt.read'],
  },
  {
    category: 'Case',
    screen: 'Case detail — Status transition button',
    flags: ['caseMgmt.write', 'verifyCases.access', 'workOnCases.access', 'workAllocation.access'],
    note: 'OR — any one flag is sufficient',
  },
  {
    category: 'Case',
    screen: 'Case detail — Assign button',
    flags: ['caseMgmt.write', 'workAllocation.access'],
    note: 'OR — any one flag is sufficient',
  },
  {
    category: 'Case',
    screen: 'Case detail — Self-assign button',
    flags: ['workAllocation.access'],
  },
  {
    category: 'Case',
    screen: 'Case detail — Add Note button',
    flags: ['caseMgmt.write', 'verifyCases.access', 'workOnCases.access'],
    note: 'OR — any one flag is sufficient; also status-dependent',
  },
  {
    category: 'Case',
    screen: 'Case detail — Upload Document button',
    flags: ['caseMgmt.write', 'verifyCases.access', 'workOnCases.access'],
    note: 'OR — any one flag is sufficient; also status-dependent',
  },
  {
    category: 'Case',
    screen: 'Case detail — Delete Document button',
    flags: ['caseMgmt.delete'],
  },
  {
    category: 'Case',
    screen: 'Case detail — Reopen button',
    flags: ['workAllocation.access'],
  },
  {
    category: 'Case',
    screen: 'Case detail — Client info link',
    flags: ['clientMgmt.read'],
  },

  // ── Clients ────────────────────────────────────────────────────────────────
  {
    category: 'Client',
    screen: 'Add Client button',
    flags: ['clientMgmt.write'],
  },
  {
    category: 'Client',
    screen: 'Bulk Upload button',
    flags: ['clientMgmt.write'],
  },
  {
    category: 'Client',
    screen: 'Download Template button',
    flags: ['clientMgmt.write'],
  },
  {
    category: 'Client',
    screen: 'Client list — Delete button (row)',
    flags: ['clientMgmt.delete'],
  },
  {
    category: 'Client',
    screen: 'Client detail — Edit fields / Save',
    flags: ['clientMgmt.write'],
  },
  {
    category: 'Client',
    screen: 'Client detail — Inactive toggle',
    flags: ['clientMgmt.write'],
  },
  {
    category: 'Client',
    screen: 'Client detail — Delete button',
    flags: ['clientMgmt.delete'],
  },
  {
    category: 'Client',
    screen: 'Client detail — Add compliance type',
    flags: ['clientMgmt.write'],
  },
  {
    category: 'Client',
    screen: 'Client detail — Remove compliance type',
    flags: ['clientMgmt.delete'],
  },

  // ── Compliance ─────────────────────────────────────────────────────────────
  {
    category: 'Compliance',
    screen: 'Add Compliance Type button',
    flags: ['complianceMgmt.write'],
  },
  {
    category: 'Compliance',
    screen: 'Compliance list — Delete button (row)',
    flags: ['complianceMgmt.delete'],
  },
  {
    category: 'Compliance',
    screen: 'Compliance detail — Edit fields / Save',
    flags: ['complianceMgmt.write'],
  },
  {
    category: 'Compliance',
    screen: 'Compliance detail — Inactive toggle',
    flags: ['complianceMgmt.write'],
  },
  {
    category: 'Compliance',
    screen: 'Compliance detail — Add / Edit subtype',
    flags: ['complianceMgmt.write'],
  },
  {
    category: 'Compliance',
    screen: 'Compliance detail — Delete subtype',
    flags: ['complianceMgmt.delete'],
  },
  {
    category: 'Compliance',
    screen: 'Compliance detail — Assign clients tab',
    flags: ['complianceMgmt.write', 'clientMgmt.write'],
    note: 'AND — both flags required',
  },
  {
    category: 'Compliance',
    screen: 'Compliance detail — Remove clients',
    flags: ['complianceMgmt.delete', 'clientMgmt.delete'],
    note: 'AND — both flags required',
  },

  // ── Branches ───────────────────────────────────────────────────────────────
  {
    category: 'Branch',
    screen: 'Add Branch button',
    flags: ['branchMgmt.write'],
  },
  {
    category: 'Branch',
    screen: 'Branch list — Delete button (row)',
    flags: ['branchMgmt.delete'],
  },
  {
    category: 'Branch',
    screen: 'Branch detail — Edit fields / Save',
    flags: ['branchMgmt.write'],
  },

  // ── Users ──────────────────────────────────────────────────────────────────
  {
    category: 'User',
    screen: 'Invite User button',
    flags: ['userMgmt.write'],
  },
  {
    category: 'User',
    screen: 'User list — Unlock User button',
    flags: ['userMgmt.write'],
  },
  {
    category: 'User',
    screen: 'User list — Resend Invite button',
    flags: ['userMgmt.write'],
  },
  {
    category: 'User',
    screen: 'User list — Access management modal',
    flags: ['userMgmt.write'],
  },
  {
    category: 'User',
    screen: 'User detail — Edit profile / Save',
    flags: ['userMgmt.write'],
  },
  {
    category: 'User',
    screen: 'User detail — Add to branch',
    flags: ['userMgmt.write', 'branchMgmt.read'],
    note: 'AND — both flags required',
  },
  {
    category: 'User',
    screen: 'User detail — Remove from branch',
    flags: ['userMgmt.delete'],
  },
  {
    category: 'User',
    screen: 'User detail — Add to team',
    flags: ['userMgmt.write'],
  },
  {
    category: 'User',
    screen: 'User detail — Remove from team',
    flags: ['userMgmt.delete'],
  },
  {
    category: 'User',
    screen: 'User detail — Access grid / Save access',
    flags: ['userMgmt.write'],
  },
  {
    category: 'User',
    screen: 'User invite form — Team multi-select',
    flags: ['teamMgmt.read'],
  },

  // ── Teams ──────────────────────────────────────────────────────────────────
  {
    category: 'Team',
    screen: 'Add Team button',
    flags: ['teamMgmt.write'],
  },
  {
    category: 'Team',
    screen: 'Team list — Delete button (row)',
    flags: ['teamMgmt.delete'],
  },
  {
    category: 'Team',
    screen: 'Team list — Edit inline',
    flags: ['teamMgmt.write'],
  },
  {
    category: 'Team',
    screen: 'Team detail — Edit name / leader / Save',
    flags: ['teamMgmt.write'],
  },
  {
    category: 'Team',
    screen: 'Team detail — Add member',
    flags: ['teamMgmt.write'],
  },
  {
    category: 'Team',
    screen: 'Team detail — Remove member',
    flags: ['teamMgmt.delete'],
  },

  // ── Work Allocation ────────────────────────────────────────────────────────
  {
    category: 'Work Allocation',
    screen: 'Monthly / Direct Assign / Auto-delegate tabs',
    flags: ['workAllocation.access'],
  },
  {
    category: 'Work Allocation',
    screen: 'Allocation Preview / Confirm buttons',
    flags: ['workAllocation.access'],
  },
  {
    category: 'Work Allocation',
    screen: 'Rollback batch button',
    flags: ['workAllocation.access'],
  },

  // ── My To-Do ───────────────────────────────────────────────────────────────
  {
    category: 'My To-Do',
    screen: 'My Cases section (worker queue)',
    flags: ['workOnCases.access'],
  },
  {
    category: 'My To-Do',
    screen: 'Pending Verification section',
    flags: ['verifyCases.access'],
  },
];

// ─── Build matrix ──────────────────────────────────────────────────────────────

function buildRow(row) {
  const flagSet = new Set(row.flags);
  return COLUMNS.map(col => flagSet.has(col) ? '✓' : '✗');
}

// ─── Console output ────────────────────────────────────────────────────────────

function printConsole() {
  const COL_W  = 22;  // width per flag column
  const ROW_W  = 52;  // width of screen/button column
  const CAT_W  = 16;  // width of category column

  // Header
  console.log('\n' + '═'.repeat(ROW_W + CAT_W + COL_W * COLUMNS.length + COLUMNS.length + 3));
  console.log('  AUDITGLIDE — ACCESS CONTROL MATRIX');
  console.log('  Rows = screens/buttons   |   Columns = access flags');
  console.log('  ✓ = this flag gates the screen/button   |   ✗ = not involved');
  console.log('═'.repeat(ROW_W + CAT_W + COL_W * COLUMNS.length + COLUMNS.length + 3) + '\n');

  // Group short column names for display (split at '.')
  const colHeaders = COLUMNS.map(c => {
    const parts = c.split('.');
    return { mod: parts[0], perm: parts[1] };
  });

  // Column header line 1 (module names, grouped)
  process.stdout.write('  ' + 'Category'.padEnd(CAT_W) + '  ' + 'Screen / Button'.padEnd(ROW_W) + '  ');
  colHeaders.forEach(h => process.stdout.write(h.mod.padEnd(COL_W)));
  console.log();

  // Column header line 2 (permission names)
  process.stdout.write('  ' + ' '.repeat(CAT_W) + '  ' + ' '.repeat(ROW_W) + '  ');
  colHeaders.forEach(h => process.stdout.write(('.'+h.perm).padEnd(COL_W)));
  console.log();

  console.log('  ' + '─'.repeat(CAT_W) + '  ' + '─'.repeat(ROW_W) + '  ' + '─'.repeat(COL_W * COLUMNS.length));

  let lastCat = '';
  for (const row of ROWS) {
    if (row.category !== lastCat) {
      console.log();
      lastCat = row.category;
    }
    const cells = buildRow(row);
    const label = row.screen.length > ROW_W ? row.screen.slice(0, ROW_W - 1) + '…' : row.screen;
    process.stdout.write('  ' + row.category.padEnd(CAT_W) + '  ' + label.padEnd(ROW_W) + '  ');
    cells.forEach(c => process.stdout.write(c.padEnd(COL_W)));
    if (row.note) process.stdout.write(`  [${row.note}]`);
    console.log();
  }

  console.log('\n' + '═'.repeat(ROW_W + CAT_W + COL_W * COLUMNS.length + COLUMNS.length + 3) + '\n');
}

// ─── CSV output ────────────────────────────────────────────────────────────────

function writeCsv() {
  const outputPath = path.join(__dirname, 'access-matrix.csv');

  const escape = v => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [];

  // Header row
  lines.push(['Category', 'Screen / Button', ...COLUMNS, 'Notes'].map(escape).join(','));

  // Data rows
  for (const row of ROWS) {
    const cells = buildRow(row).map(c => c === '✗' ? '' : c);
    lines.push([
      escape(row.category),
      escape(row.screen),
      ...cells.map(escape),
      escape(row.note ?? ''),
    ].join(','));
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`CSV saved → ${outputPath}`);
}

// ─── Run ───────────────────────────────────────────────────────────────────────

printConsole();
writeCsv();
