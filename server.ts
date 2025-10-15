import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import * as XLSX from 'xlsx';
import util from 'node:util';

// ============================================
// 🔵 LOGS DE DEBUG AU DÉMARRAGE
// ============================================
console.log('🔵 Server script starting...');
console.log('📂 Working directory:', process.cwd());
console.log('📂 Node version:', process.version);

// Test de chargement des modules avant import
console.log('🔍 Testing module loading...');
try {
  require('./api/scraper');
  console.log('✅ api/scraper found');
} catch (err: any) {
  console.error('❌ Cannot load api/scraper:', err.message);
  console.error('   Path attempted:', path.join(__dirname, 'api/scraper'));
  process.exit(1);
}

try {
  require('./api/scraper-masecurite');
  console.log('✅ api/scraper-masecurite found');
} catch (err: any) {
  console.error('❌ Cannot load api/scraper-masecurite:', err.message);
  process.exit(1);
}

// Import réel après vérification
import { scrape as scrapeServicePublic } from './api/scraper';
import { scrapeMaSecurite } from './api/scraper-masecurite';

console.log('✅ All modules loaded successfully');

// ============================================
// 🚀 CONFIGURATION EXPRESS
// ============================================
const app = express();
const port = 3000;

app.set('trust proxy', 1);

// CORS simple et permissif
app.use(cors());
app.use(express.json());

// ============================================
// 📁 SERVE ANGULAR BUILD
// ============================================
const distFolder = path.join(process.cwd(), 'dist/annuaire-app/browser');
console.log('📂 Angular dist folder:', distFolder);
app.use(express.static(distFolder));

// ============================================
// 💾 STOCKAGE DES SESSIONS SSE
// ============================================
interface LogSession {
  clients: Response[];
  logs: string[];
}

const sessions = new Map<string, LogSession>();

// ⚡ SAUVEGARDE DU console.log ORIGINAL (GLOBAL)
const originalConsoleLog = console.log;

function log(sessionId: string, message: string) {
  const timestamp = new Date().toISOString().substring(11, 19);
  const formattedLog = `[${timestamp}] ${message}`;
  
  // ✅ Utilise la version ORIGINALE pour éviter la boucle infinie
  originalConsoleLog(formattedLog);
  
  const session = sessions.get(sessionId);
  if (!session) return;
  
  session.logs.push(formattedLog);
  
  const sseData = JSON.stringify({
    type: 'log',
    message: formattedLog,
    timestamp: Date.now()
  });
  
  session.clients.forEach(client => {
    try {
      client.write(`data: ${sseData}\n\n`);
    } catch (e) {
      originalConsoleLog('SSE write error:', e);
    }
  });
}

// ============================================
// 🔌 ENDPOINT SSE : LOGS EN TEMPS RÉEL
// ============================================
app.get('/api/logs/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  originalConsoleLog(`📡 SSE connection opened: ${sessionId}`);
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { clients: [], logs: [] });
  }
  
  const session = sessions.get(sessionId)!;
  session.clients.push(res);
  
  // Heartbeat toutes les 30s
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 30000);
  
  req.on('close', () => {
    originalConsoleLog(`📡 SSE connection closed: ${sessionId}`);
    clearInterval(heartbeat);
    
    const session = sessions.get(sessionId);
    if (session) {
      session.clients = session.clients.filter(c => c !== res);
      
      if (session.clients.length === 0) {
        setTimeout(() => {
          const s = sessions.get(sessionId);
          if (s && s.clients.length === 0) {
            sessions.delete(sessionId);
            originalConsoleLog(`🗑️  Session deleted: ${sessionId}`);
          }
        }, 60000);
      }
    }
  });
});

// ============================================
// 🔍 ENDPOINT : RECHERCHE UNIFIÉE
// ============================================
interface UnifiedRow {
  source: string;
  nom: string;
  adresse: string;
  telephone: string;
  ville: string;
  type: string;
  region?: string;
  statut?: string;
  email?: string;
  site?: string;
  url?: string;
  latitude?: string;
  longitude?: string;
}

app.post('/api/search', async (req: Request, res: Response): Promise<void> => {
  const { what, where = '', maxPages = 3, sessionId } = req.body;
  
  if (!what) {
    res.status(400).json({
      success: false,
      error: 'Le paramètre "what" est requis'
    });
    return;
  }
  
  const sid = sessionId || `session_${Date.now()}`;
  
  if (!sessions.has(sid)) {
    sessions.set(sid, { clients: [], logs: [] });
  }
  
  log(sid, `🔍 Nouvelle recherche: "${what}" | Lieu: "${where || 'France entière'}" | Pages: ${maxPages}`);
  
  try {
    const allResults: UnifiedRow[] = [];
    
    // ==========================================
    // 1️⃣ SERVICE-PUBLIC.FR
    // ==========================================
    log(sid, '📍 [1/2] Scraping Service-Public.fr...');
    
    // ✅ Redirection PROPRE du console.log
    console.log = (...args: any[]) => {
      const msg = util.format(...args);
      log(sid, msg);
    };
    
    try {
      const servicePublicData = await scrapeServicePublic(what, where, maxPages);
      
      const servicePublicUnified: UnifiedRow[] = servicePublicData.map(r => ({
        source: 'Service-Public',
        nom: r.nom,
        adresse: r.adresse,
        telephone: r.telephone,
        ville: extractVille(r.adresse),
        type: detectType(r.nom),
        region: r.region,
        email: r.email,
        site: r.site,
        url: r.url,
        latitude: r.latitude,
        longitude: r.longitude
      }));
      
      log(sid, `✅ Service-Public: ${servicePublicUnified.length} résultats`);
      allResults.push(...servicePublicUnified);
      
    } catch (err: any) {
      log(sid, `❌ Erreur Service-Public: ${err.message}`);
    }
    
    // ==========================================
    // 2️⃣ MASÉCURITÉ.GOUV.FR
    // ==========================================
    log(sid, '📍 [2/2] Scraping MaSécurité.gouv.fr...');
    
    try {
      const maSecuriteData = await scrapeMaSecurite(what, where);
      
      const maSecuriteUnified: UnifiedRow[] = maSecuriteData.map(r => ({
        source: 'MaSécurité',
        nom: r.nom,
        adresse: r.adresse,
        telephone: r.telephone,
        ville: r.ville,
        type: r.type,
        statut: r.statut
      }));
      
      log(sid, `✅ MaSécurité: ${maSecuriteUnified.length} résultats`);
      allResults.push(...maSecuriteUnified);
      
    } catch (err: any) {
      log(sid, `❌ Erreur MaSécurité: ${err.message}`);
    }
    
    // ✅ Restauration du console.log original
    console.log = originalConsoleLog;
    
    // Filtrer les erreurs
    const cleanResults = allResults.filter(row => 
      !row.nom.includes('BLOQUÉ-') && 
      !row.nom.includes('renforce temporairement') &&
      !row.nom.includes('Erreur-')
    );
    
    log(sid, `✅ Scraping terminé: ${cleanResults.length} résultats uniques`);
    
    const servicePublicCount = cleanResults.filter(r => r.source === 'Service-Public').length;
    const maSecuriteCount = cleanResults.filter(r => r.source === 'MaSécurité').length;
    
    res.json({
      success: true,
      rows: cleanResults,
      stats: {
        total: cleanResults.length,
        servicePublic: servicePublicCount,
        maSecurite: maSecuriteCount
      },
      sessionId: sid
    });
    
  } catch (error: any) {
    // ✅ Restauration en cas d'erreur aussi
    console.log = originalConsoleLog;
    
    log(sid, `❌ Erreur globale: ${error.message}`);
    originalConsoleLog('Search error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur lors du scraping'
    });
  }
});

// ============================================
// 📊 ENDPOINT : EXPORT XLSX
// ============================================
app.post('/api/download/xlsx', async (req: Request, res: Response): Promise<void> => {
  const { what, where = '', maxPages = 3 } = req.body;
  
  if (!what) {
    res.status(400).json({ error: 'Paramètre "what" requis' });
    return;
  }
  
  try {
    const servicePublicData = await scrapeServicePublic(what, where, maxPages);
    const maSecuriteData = await scrapeMaSecurite(what, where);
    
    const allData = [
      ...servicePublicData.map(r => ({
        Source: 'Service-Public',
        Nom: r.nom,
        Adresse: r.adresse,
        Téléphone: r.telephone,
        Email: r.email || '',
        Site: r.site || '',
        Région: r.region || '',
        Latitude: r.latitude || '',
        Longitude: r.longitude || '',
        URL: r.url || ''
      })),
      ...maSecuriteData.map(r => ({
        Source: 'MaSécurité',
        Nom: r.nom,
        Adresse: r.adresse,
        Téléphone: r.telephone,
        Email: '',
        Site: '',
        Région: '',
        Latitude: '',
        Longitude: '',
        URL: '',
        Statut: r.statut || '',
        Type: r.type || ''
      }))
    ];
    
    const ws = XLSX.utils.json_to_sheet(allData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Résultats');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="annuaire_${what.replace(/\s+/g, '_')}.xlsx"`);
    res.send(buffer);
    
  } catch (error: any) {
    originalConsoleLog('XLSX error:', error);
    res.status(500).json({ error: error.message || 'Erreur export XLSX' });
  }
});

// ============================================
// 🏠 FALLBACK : ANGULAR SPA
// ============================================
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(distFolder, 'index.html'));
});

// ============================================
// 🚀 DÉMARRAGE DU SERVEUR
// ============================================
app.listen(port, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   ✅ SERVER STARTED SUCCESSFULLY      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`   🌐 URL: http://localhost:${port}`);
  console.log(`   📂 Serving: ${distFolder}`);
  console.log('');
}).on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error('╔════════════════════════════════════════╗');
    console.error('║   ❌ PORT ALREADY IN USE              ║');
    console.error('╚════════════════════════════════════════╝');
    console.error(`   Port ${port} is already in use`);
    console.error('   Run: lsof -i :3000 to find the process');
    console.error('');
  } else {
    console.error('❌ Server error:', err);
  }
  process.exit(1);
});

// ============================================
// 🛠️ FONCTIONS UTILITAIRES
// ============================================
function extractVille(adresse: string): string {
  if (!adresse) return '';
  
  const match = adresse.match(/\d{5}\s+(.+?)(?:\s|$)/);
  if (match) {
    return match[1].trim();
  }
  
  const parts = adresse.split(' ');
  return parts[parts.length - 1];
}

function detectType(nom: string): string {
  const lower = nom.toLowerCase();
  if (lower.includes('commissariat')) return 'Commissariat';
  if (lower.includes('gendarmerie')) return 'Gendarmerie';
  if (lower.includes('police')) return 'Police';
  if (lower.includes('peloton')) return 'Peloton';
  if (lower.includes('brigade')) return 'Brigade';
  if (lower.includes('mairie')) return 'Mairie';
  if (lower.includes('préfecture')) return 'Préfecture';
  return 'Autre';
}