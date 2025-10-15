// server.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import * as XLSX from 'xlsx';
import util from 'node:util';
import { scrape as scrapeServicePublic } from './api/scraper';
import { scrapeMaSecurite } from './api/scraper-masecurite';

const app = express();
const port = Number(process.env.PORT || 3000);

/* =========================
 *  CORS (whitelist optionnelle)
 * ========================= */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0) return cb(null, true);
    return allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json());

/* =========================
 *  SERVE ANGULAR BUILD (si front + API ensemble)
 * ========================= */
const distFolder = path.join(process.cwd(), 'dist/annuaire-app/browser');
app.use(express.static(distFolder));

/* =========================
 *  Types communs
 * ========================= */
interface UnifiedRow {
  source: string;
  nom: string;
  adresse: string;
  telephone: string;
  ville: string;
  type: string;
  email?: string;
  site?: string;
  region?: string;
  latitude?: string;
  longitude?: string;
  statut?: string;
  url?: string;
}

/* =========================
 *  LOGS SÉCURISÉS (pas de récursion)
 * ========================= */
const logsStore = new Map<string, string[]>();

const ORIG_CONSOLE = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function formatArgs(args: any[]): string {
  return args.map(a =>
    typeof a === 'string'
      ? a
      : util.inspect(a, { depth: 4, colors: false, maxArrayLength: 200, maxStringLength: 2000, compact: 3 })
  ).join(' ');
}

function appendLog(sessionId: string, message: string) {
  if (!logsStore.has(sessionId)) logsStore.set(sessionId, []);
  const ts = new Date().toLocaleTimeString();
  logsStore.get(sessionId)!.push(`[${ts}] ${message}`);
}

function emitLog(sessionId: string, message: string) {
  appendLog(sessionId, message);
  ORIG_CONSOLE.log(message);
}

function captureConsoleLogs(sessionId: string) {
  const restore = {
    log: console.log, info: console.info, warn: console.warn, error: console.error,
  };

  console.log = (...args: any[]) => { const msg = formatArgs(args); appendLog(sessionId, msg); ORIG_CONSOLE.log(msg); };
  console.info = (...args: any[]) => { const msg = formatArgs(args); appendLog(sessionId, msg); ORIG_CONSOLE.info(msg); };
  console.warn = (...args: any[]) => { const msg = formatArgs(args); appendLog(sessionId, msg); ORIG_CONSOLE.warn(msg); };
  console.error = (...args: any[]) => { const msg = '❌ ' + formatArgs(args); appendLog(sessionId, msg); ORIG_CONSOLE.error(msg); };

  return () => { console.log = restore.log; console.info = restore.info; console.warn = restore.warn; console.error = restore.error; };
}

/* =========================
 *  HEALTHCHECK (Railway)
 * ========================= */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

/* =========================
 *  SSE LOGS (avec heartbeat)
 * ========================= */
app.get('/api/logs/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();

  res.write('data: {"type":"connected"}\n\n');

  if (logsStore.has(sessionId)) {
    for (const log of logsStore.get(sessionId)!) {
      res.write(`data: ${JSON.stringify({ type: 'log', message: log })}\n\n`);
    }
  }

  let lastIndex = logsStore.get(sessionId)?.length || 0;
  const pushInterval = setInterval(() => {
    if (!logsStore.has(sessionId)) return;
    const logs = logsStore.get(sessionId)!;
    for (const log of logs.slice(lastIndex)) {
      res.write(`data: ${JSON.stringify({ type: 'log', message: log })}\n\n`);
    }
    lastIndex = logs.length;
  }, 500);

  const heartbeat = setInterval(() => res.write(':\n\n'), 15000);

  req.on('close', () => {
    clearInterval(pushInterval);
    clearInterval(heartbeat);
    setTimeout(() => logsStore.delete(sessionId), 5 * 60 * 1000);
  });
});

/* =========================
 *  ENDPOINT PRINCIPAL /api/search
 * ========================= */
app.post('/api/search', async (req: Request, res: Response) => {
  const { what, where = '', maxPages = 3, sessionId } = req.body;

  if (!what) return res.status(400).json({ error: 'Le paramètre "what" est requis' });

  const sid = sessionId || `session_${Date.now()}`;
  logsStore.set(sid, []);
  const restoreConsole = captureConsoleLogs(sid);

  try {
    emitLog(sid, '╔═══════════════════════════════════════╗');
    emitLog(sid, '║   🔍 SCRAPING UNIFIÉ (2 SOURCES)     ║');
    emitLog(sid, '╚═══════════════════════════════════════╝');
    emitLog(sid, `   Recherche: "${what}"`);
    emitLog(sid, `   Localisation: "${where || 'France entière'}"`);
    emitLog(sid, `   Pages max: ${maxPages}\n`);

    const allRows: UnifiedRow[] = [];

    // 1) Service-Public
    emitLog(sid, '📍 [1/2] Scraping Service-Public.fr...\n');
    try {
      const spResults = await scrapeServicePublic(what, where, maxPages);
      spResults.forEach(row =>
        allRows.push({
          source: 'Service-Public',
          nom: row.nom,
          adresse: row.adresse,
          telephone: row.telephone,
          ville: extractVille(row.adresse),
          type: detectType(row.nom),
          email: row.email,
          site: row.site,
          region: row.region,
          latitude: row.latitude,
          longitude: row.longitude,
          url: row.url,
        })
      );
      emitLog(sid, `   ✅ Service-Public: ${spResults.length} résultats\n`);
    } catch (e: any) {
      emitLog(sid, `   ❌ Erreur Service-Public: ${e.message}\n`);
    }

    // 2) MaSécurité
    emitLog(sid, '📍 [2/2] MaSécurité.interieur.gouv.fr...\n');
    try {
      const msResults = await scrapeMaSecurite(what, where);
      msResults.forEach(row =>
        allRows.push({
          source: 'MaSécurité',
          nom: row.nom,
          adresse: row.adresse,
          telephone: row.telephone,
          ville: row.ville,
          type: row.type,
          statut: row.statut,
        })
      );
      emitLog(sid, `   ✅ MaSécurité: ${msResults.length} résultats\n`);
    } catch (e: any) {
      emitLog(sid, `   ❌ Erreur MaSécurité: ${e.message}\n`);
    }

    const spCount = allRows.filter(r => r.source === 'Service-Public').length;
    const msCount = allRows.filter(r => r.source === 'MaSécurité').length;

    emitLog(sid, '╔═══════════════════════════════════════╗');
    emitLog(sid, '║          📊 STATISTIQUES FINALES      ║');
    emitLog(sid, '╚═══════════════════════════════════════╝');
    emitLog(sid, `   Service-Public:    ${spCount} résultats`);
    emitLog(sid, `   MaSécurité:        ${msCount} résultats`);
    emitLog(sid, '   ─────────────────────────────────────');
    emitLog(sid, `   ✅ RÉSULTATS UNIQUES: ${allRows.length}\n`);

    res.json({
      success: true,
      rows: allRows,
      stats: { total: allRows.length, servicePublic: spCount, maSecurite: msCount },
      sessionId: sid,
    });
  } catch (e: any) {
    emitLog(sid, `❌ Erreur globale: ${e.message}`);
    res.status(500).json({ error: e.message });
  } finally {
    restoreConsole();
  }
});

/* =========================
 *  EXPORT XLSX
 * ========================= */
app.post('/api/download/xlsx', async (req: Request, res: Response) => {
  const { what, where = '', maxPages = 3 } = req.body;

  try {
    const spResults = await scrapeServicePublic(what, where, maxPages);
    const msResults = await scrapeMaSecurite(what, where);

    const allRows = [
      ...spResults.map(r => ({ ...r, source: 'Service-Public' })),
      ...msResults.map(r => ({ ...r, source: 'MaSécurité' })),
    ];

    const ws = XLSX.utils.json_to_sheet(allRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Résultats');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="annuaire_${what.replace(/\s+/g, '_')}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================
 *  HELPERS
 * ========================= */
function extractVille(adresse: string): string {
  const match = adresse.match(/\d{5}\s+(.+?)$/);
  return match ? match[1].trim() : '';
}
function detectType(nom: string): string {
  const lower = nom.toLowerCase();
  if (lower.includes('commissariat')) return 'Commissariat';
  if (lower.includes('gendarmerie')) return 'Gendarmerie';
  if (lower.includes('mairie')) return 'Mairie';
  if (lower.includes('préfecture')) return 'Préfecture';
  if (lower.includes('police')) return 'Police';
  return 'Autre';
}

/* =========================
 *  FALLBACK ANGULAR
 * ========================= */
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(distFolder, 'index.html'));
});

/* =========================
 *  START (avec ta bannière)
 * ========================= */
app.listen(port, '0.0.0.0', () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║ 🚀 SERVEUR SCRAPER UNIFIÉ              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n✅ Serveur sur http://0.0.0.0:${port}`);
  console.log(`📍 Routes API:`);
  console.log(`   - GET  /api/health`);
  console.log(`   - GET  /api/logs/:sessionId  (SSE)`);
  console.log(`   - POST /api/search`);
  console.log(`   - POST /api/download/xlsx`);
  console.log(`💡 CTRL+C pour arrêter\n`);
});
