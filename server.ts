// server.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import * as XLSX from 'xlsx';
import util from 'node:util';
import { scrape as scrapeServicePublic } from './api/scraper';
import { scrapeMaSecurite } from './api/scraper-masecurite';

const app = express();
const PORT = process.env['PORT'] || 3000;

/* ============================================================
 * CONFIG DE BASE EXPRESS
 * ============================================================ */
app.use(cors());
app.use(express.json());
app.use(express.static('dist/annuaire-app/browser'));

/* ============================================================
 * INTERFACE UNIFIÉE
 * ============================================================ */
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

/* ============================================================
 * SYSTÈME DE LOGS SÉCURISÉ
 * ============================================================ */

// Stockage des logs par sessionId
const logsStore = new Map<string, string[]>();

// Sauvegarde des consoles d'origine
const ORIG_CONSOLE = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

// Formatage sûr des arguments (évite JSON.stringify infini)
function formatArgs(args: any[]): string {
  return args
    .map((a) =>
      typeof a === 'string'
        ? a
        : util.inspect(a, {
            depth: 4,
            colors: false,
            maxArrayLength: 200,
            maxStringLength: 2000,
            compact: 3,
          })
    )
    .join(' ');
}

// Ajoute un log à la session
function appendLog(sessionId: string, message: string) {
  if (!logsStore.has(sessionId)) logsStore.set(sessionId, []);
  const timestamp = new Date().toLocaleTimeString();
  logsStore.get(sessionId)!.push(`[${timestamp}] ${message}`);
}

// Émet un log côté serveur + store
function emitLog(sessionId: string, message: string) {
  appendLog(sessionId, message);
  ORIG_CONSOLE.log(message);
}

// Capture console.log / console.error sans récursion
function captureConsoleLogs(sessionId: string) {
  const restore = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  console.log = (...args: any[]) => {
    const msg = formatArgs(args);
    appendLog(sessionId, msg);
    ORIG_CONSOLE.log(msg);
  };

  console.info = (...args: any[]) => {
    const msg = formatArgs(args);
    appendLog(sessionId, msg);
    ORIG_CONSOLE.info(msg);
  };

  console.warn = (...args: any[]) => {
    const msg = formatArgs(args);
    appendLog(sessionId, msg);
    ORIG_CONSOLE.warn(msg);
  };

  console.error = (...args: any[]) => {
    const msg = '❌ ' + formatArgs(args);
    appendLog(sessionId, msg);
    ORIG_CONSOLE.error(msg);
  };

  // Fonction de restauration
  return () => {
    console.log = restore.log;
    console.info = restore.info;
    console.warn = restore.warn;
    console.error = restore.error;
  };
}

/* ============================================================
 * SSE LOG STREAM (temps réel)
 * ============================================================ */
app.get('/api/logs/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.write('data: {"type":"connected"}\n\n');

  // Envoyer les logs existants
  if (logsStore.has(sessionId)) {
    for (const log of logsStore.get(sessionId)!) {
      res.write(`data: ${JSON.stringify({ type: 'log', message: log })}\n\n`);
    }
  }

  // Polling
  let lastIndex = logsStore.get(sessionId)?.length || 0;
  const interval = setInterval(() => {
    if (!logsStore.has(sessionId)) return;
    const logs = logsStore.get(sessionId)!;
    const newLogs = logs.slice(lastIndex);
    for (const log of newLogs) {
      res.write(`data: ${JSON.stringify({ type: 'log', message: log })}\n\n`);
    }
    lastIndex = logs.length;
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
    setTimeout(() => logsStore.delete(sessionId), 5 * 60 * 1000);
  });
});

/* ============================================================
 * ENDPOINT PRINCIPAL DE RECHERCHE
 * ============================================================ */
app.post('/api/search', async (req: Request, res: Response) => {
  const { what, where = '', maxPages = 3, sessionId } = req.body;

  if (!what) {
    return res.status(400).json({ error: 'Le paramètre "what" est requis' });
  }

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

    // 1️⃣ SERVICE-PUBLIC.FR
    emitLog(sid, '📍 [1/2] Scraping Service-Public.fr...\n');
    try {
      const spResults = await scrapeServicePublic(what, where, maxPages);
      spResults.forEach((row) =>
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
    } catch (error: any) {
      emitLog(sid, `   ❌ Erreur Service-Public: ${error.message}\n`);
    }

    // 2️⃣ MASÉCURITÉ
    emitLog(sid, '📍 [2/2] MaSécurité.interieur.gouv.fr...\n');
    try {
      const msResults = await scrapeMaSecurite(what, where);
      msResults.forEach((row) =>
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
    } catch (error: any) {
      emitLog(sid, `   ❌ Erreur MaSécurité: ${error.message}\n`);
    }

    // STATISTIQUES FINALES
    const spCount = allRows.filter((r) => r.source === 'Service-Public').length;
    const msCount = allRows.filter((r) => r.source === 'MaSécurité').length;

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
  } catch (error: any) {
    emitLog(sid, `❌ Erreur globale: ${error.message}`);
    res.status(500).json({ error: error.message });
  } finally {
    restoreConsole();
  }
});

/* ============================================================
 * EXPORT EXCEL
 * ============================================================ */
app.post('/api/download/xlsx', async (req: Request, res: Response) => {
  const { what, where = '', maxPages = 3 } = req.body;

  try {
    const spResults = await scrapeServicePublic(what, where, maxPages);
    const msResults = await scrapeMaSecurite(what, where);

    const allRows = [
      ...spResults.map((r) => ({ ...r, source: 'Service-Public' })),
      ...msResults.map((r) => ({ ...r, source: 'MaSécurité' })),
    ];

    const ws = XLSX.utils.json_to_sheet(allRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Résultats');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="annuaire_${what.replace(/\s+/g, '_')}.xlsx"`
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================
 * HELPERS
 * ============================================================ */
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

/* ============================================================
 * FALLBACK ANGULAR
 * ============================================================ */
app.get('*', (req: Request, res: Response) => {
  res.sendFile('index.html', { root: 'dist/annuaire-app/browser' });
});

/* ============================================================
 * LANCEMENT SERVEUR
 * ============================================================ */
app.listen(PORT, () => {
  ORIG_CONSOLE.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});
