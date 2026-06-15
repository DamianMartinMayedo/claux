// Migrate inline SVGs to lucide-react. Safe approach: function-by-function replacement.
const fs = require('fs')
const { execSync } = require('child_process')

const SRC = 'src'
const files = execSync(`find ${SRC} -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.next/*" | grep -v PortalSidebar | grep -v "admin.*Sidebar" | grep -v DashboardView`, { encoding: 'utf8' }).trim().split('\n')

function slurp(f) { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
function spit(f, c) { fs.writeFileSync(f, c) }

const ICON_MAP = {
  // SVG patterns → [lucideName, lucideSize, lucideStrokeWidth]
  'X': [
    [/<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"[^>]*>[\s\S]*?<line x1="18" y1="6" x2="6" y2="18"\/>[\s\S]*?<line x1="6" y1="6" x2="18" y2="18"\/>[\s\S]*?<\/svg>/g, 18, 2],
    [/<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"[^>]*>[\s\S]*?<line x1="18" y1="6" x2="6" y2="18"\/>[\s\S]*?<line x1="6" y1="6" x2="18" y2="18"\/>[\s\S]*?<\/svg>/g, 14, 2],
  ],
  'Plus': [
    [/<svg[^>]*width="14" height="14"[^>]*>[\s\S]*?<line x1="12" y1="5" x2="12" y2="19"\/>[\s\S]*?<line x1="5" y1="12" x2="19" y2="12"\/>[\s\S]*?<\/svg>/g, 14, 2],
    [/<svg[^>]*strokeWidth="2\.5"[^>]*width="14"[^>]*>[\s\S]*?<line x1="12" y1="5" x2="12" y2="19"\/>[\s\S]*?<line x1="5" y1="12" x2="19" y2="12"\/>[\s\S]*?<\/svg>/g, 14, 2.5],
  ],
  'Pencil': [
    [/<svg[^>]*width="14" height="14"[^>]*>[\s\S]*?<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"\/>[\s\S]*?<path d="M18\.5 2\.5a2\.121 2\.121 0 0 1 3 3L12 15l-4 1 1-4 9\.5-9\.5z"\/>[\s\S]*?<\/svg>/g, 14, 2],
    [/<svg[^>]*width="15" height="15"[^>]*>[\s\S]*?<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"\/>[\s\S]*?<path d="M18\.5 2\.5a2\.121 2\.121 0 0 1 3 3L12 15l-4 1 1-4 9\.5-9\.5z"\/>[\s\S]*?<\/svg>/g, 15, 2],
  ],
  'Search': [
    [/<svg[^>]*viewBox="0 0 24 24"[^>]*>[\s\S]*?<circle cx="11" cy="11" r="8"\/>[\s\S]*?<line x1="21" y1="21" x2="16\.65" y2="16\.65"\/>[\s\S]*?<\/svg>/g, 18, 2],
    [/<svg[^>]*viewBox="0 0 24 24"[^>]*>[\s\S]*?<circle cx="11" cy="11" r="8"\/>[\s\S]*?<line x1="21" y1="21" x2="16\.65" y2="16\.65"\/>[\s\S]*?<\/svg>/g, 14, 2],
  ],
  'MoreHorizontal': [
    [/<svg[^>]*width="18" height="18"[^>]*>[\s\S]*?<circle cx="12" cy="5" r="1\.5"\/>[\s\S]*?<circle cx="12" cy="12" r="1\.5"\/>[\s\S]*?<circle cx="12" cy="19" r="1\.5"\/>[\s\S]*?<\/svg>/g, 18, 2],
  ],
  'Check': [
    [/<svg[^>]*width="14" height="14"[^>]*>[\s\S]*?<polyline points="20 6 9 17 4 12"\/>[\s\S]*?<\/svg>/g, 14, 2],
  ],
  'Ban': [
    [/<svg[^>]*width="14" height="14"[^>]*>[\s\S]*?<circle cx="12" cy="12" r="10"\/>[\s\S]*?<line x1="4\.93" y1="4\.93" x2="19\.07" y2="19\.07"\/>[\s\S]*?<\/svg>/g, 14, 2],
  ],
  'AlertTriangle': [
    [/<svg[^>]*width="15" height="15"[^>]*>[\s\S]*?<path d="M10\.29 3\.86L1\.82 18a2 2 0 001\.71 3h16\.94a2 2 0 001\.71-3L13\.71 3\.86a2 2 0 00-3\.42 0z"\/>[\s\S]*?<line x1="12" y1="9" x2="12" y2="13"\/>[\s\S]*?<line x1="12" y1="17" x2="12\.01" y2="17"\/>[\s\S]*?<\/svg>/g, 15, 2],
  ],
  'Info': [
    [/<svg[^>]*viewBox="0 0 24 24"[^>]*strokeLinecap="round" strokeLinejoin="round"[^>]*>[\s\S]*?<circle cx="12" cy="12" r="10"\/>[\s\S]*?<line x1="12" y1="8" x2="12" y2="12"\/>[\s\S]*?<line x1="12" y1="16" x2="12\.01" y2="16"\/>[\s\S]*?<\/svg>/g, 20, 2],
  ],
  'Clock': [
    [/<svg[^>]*viewBox="0 0 24 24"[^>]*strokeLinecap="round" strokeLinejoin="round"[^>]*>[\s\S]*?<circle cx="12" cy="12" r="10"\/>[\s\S]*?<polyline points="12 6 12 12 16 14"\/>[\s\S]*?<\/svg>/g, 20, 2],
  ],
  'Eye': [
    [/<svg[^>]*width="14" height="14"[^>]*>[\s\S]*?<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"\/>[\s\S]*?<circle cx="12" cy="12" r="3"\/>[\s\S]*?<\/svg>/g, 14, 2],
  ],
  'Copy': [
    [/<svg[^>]*width="14" height="14"[^>]*>[\s\S]*?<rect x="9" y="9" width="13" height="13" rx="2" ry="2"\/>[\s\S]*?<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"\/>[\s\S]*?<\/svg>/g, 14, 2],
  ],
  'DollarSign': [
    [/<svg[^>]*width="14" height="14"[^>]*>[\s\S]*?<line x1="12" y1="1" x2="12" y2="23"\/>[\s\S]*?<path d="M17 5H9\.5a3\.5 3\.5 0 0 0 0 7h5a3\.5 3\.5 0 0 1 0 7H6"\/>[\s\S]*?<\/svg>/g, 14, 2],
  ],
  'LogOut': [
    [/<svg[^>]*width="18" height="18"[^>]*>[\s\S]*?<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"\/>[\s\S]*?<polyline points="16 17 21 12 16 7"\/>[\s\S]*?<line x1="21" y1="12" x2="9" y2="12"\/>[\s\S]*?<\/svg>/g, 18, 2],
  ],
  'Trash2': [
    [/<svg[^>]*width="14" height="14"[^>]*>[\s\S]*?<polyline points="3 6 5 6 21 6"\/>[\s\S]*?<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"\/>[\s\S]*?<path d="M10 11v6"\/>[\s\S]*?<path d="M14 11v6"\/>[\s\S]*?<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"\/>[\s\S]*?<\/svg>/g, 14, 2],
  ],
  'RotateCcw': [
    [/<svg[^>]*width="14" height="14"[^>]*>[\s\S]*?<polyline points="1 4 1 10 7 10"\/>[\s\S]*?<path d="M3\.51 15a9 9 0 1 0 2\.13-9\.36L1 10"\/>[\s\S]*?<\/svg>/g, 14, 2],
  ],
  'FileText': [
    [/<svg[^>]*width="36" height="36"[^>]*>[\s\S]*?<rect x="1" y="4" width="22" height="16" rx="2"\/>[\s\S]*?<line x1="1" y1="10" x2="23" y2="10"\/>[\s\S]*?<\/svg>/g, 36, 2],
  ],
  'Calendar': [
    [/<svg[^>]*width="18" height="18"[^>]*strokeWidth="2"[^>]*>[\s\S]*?<rect x="3" y="4" width="18" height="18" rx="2" ry="2"\/>[\s\S]*?<line x1="16" y1="2" x2="16" y2="6"\/>[\s\S]*?<line x1="8" y1="2" x2="8" y2="6"\/>[\s\S]*?<line x1="3" y1="10" x2="21" y2="10"\/>[\s\S]*?<\/svg>/g, 18, 2],
  ],
  'Printer': [
    [/<svg[^>]*width="18" height="18"[^>]*strokeWidth="2"[^>]*>[\s\S]*?<polyline points="6 9 6 2 18 2 18 9"\/>[\s\S]*?<path d="M6 12H4a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4z"\/>[\s\S]*?<rect x="8" y="14" width="8" height="8" rx="1"\/>[\s\S]*?<\/svg>/g, 18, 2],
  ],
}

// Find unique lucide icons needed per file
function getNeededIcons(content) {
  const needed = new Set()
  for (const [name, patterns] of Object.entries(ICON_MAP)) {
    for (const [regex] of patterns) {
      // Test before replacing to see if pattern matched
      if (regex.test(content)) {
        needed.add(name)
        break
      }
    }
  }
  return [...needed]
}

let count = 0

for (const file of files) {
  if (!file || !fs.existsSync(file)) continue
  
  let content = slurp(file)
  if (!content.includes('<svg')) continue
  
  // First pass: count SVG tags to see if this file is worth processing
  const svgCount = (content.match(/<svg/g) || []).length
  if (svgCount === 0) continue
  
  // Determine which icons are used BEFORE replacement
  const needed = getNeededIcons(content)
  if (needed.length === 0) continue
  
  // Apply replacements
  for (const [name, patterns] of Object.entries(ICON_MAP)) {
    for (const [regex, size, strokeWidth] of patterns) {
      content = content.replace(regex, `<${name} size={${size}} strokeWidth={${strokeWidth}} />`)
    }
  }
  
  // Add lucide import
  if (!content.includes("from 'lucide-react'")) {
    const importLine = `import { ${needed.join(', ')} } from 'lucide-react'`
    const lines = content.split('\n')
    let lastImportIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ')) lastImportIdx = i
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, importLine)
    } else {
      // No imports at all, insert after 'use client'
      const ucIdx = lines.findIndex(l => l.startsWith("'use client'"))
      if (ucIdx >= 0) {
        lines.splice(ucIdx + 1, 0, '', importLine)
      }
    }
    content = lines.join('\n')
  }
  
  spit(file, content)
  console.log(`  \x1b[32m✓\x1b[0m ${file} (${svgCount} SVGs → ${needed.join(', ')})`)
  count++
}

console.log(`\nDone. Processed ${count} files.`)
