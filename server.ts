import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import * as XLSX from 'xlsx';
import { scrapeUnified, UnifiedRow } from './api/scraper-unified';

const app = express();

app.use(cors());
app.use(express.json());

const distFolder = path.join(process.cwd(), 'dist/annuaire-app/browser');
app.use(express.static(distFolder));

app.get('/api/scrape', async (req: Request, res: Response) => {
  const what = String(req.query['what'] || '').trim();
  const where = String(req.query['where'] || '').trim();
  const format = String(req.query['format'] || 'json').toLowerCase();
  const maxPages = Math.max(1, Math.min(10, Number(req.query['maxPages']) || 5));

  console.log('\n🎯 Nouvelle requête UNIFIÉE:');
  console.log(` what: "${what}"`);
  console.log(` where: "${where}"`);
  console.log(` format: ${format}`);
  console.log(` maxPages: ${maxPages}`);

  if (!what) {
    return res.status(400).json({ error: 'Paramètre "what" requis' });
  }

  try {
    const startTime = Date.now();
    
    // Faire le scraping
    const allRows = await scrapeUnified(what, where, maxPages);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️ Terminé en ${duration}s`);
    console.log(`📊 ${allRows.length} résultats au total`);

    if (format === 'xlsx') {
      // Générer Excel
      const ws = XLSX.utils.json_to_sheet(allRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Annuaire');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="annuaire_${what.replace(/\s+/g, '_')}.xlsx"`
      );
      
      return res.send(buf);
    }

    // Par défaut, retourner JSON avec TOUTES les lignes
    res.json({ count: allRows.length, rows: allRows, duration: `${duration}s` });

  } catch (err: any) {
    console.error('❌ Erreur scraping:', err);
    res.status(500).json({
      error: err.message || 'Erreur serveur',
      details: err.stack
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(distFolder, 'index.html'));
});

const port = Number(process.env['PORT']) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║ 🚀 SERVEUR SCRAPER UNIFIÉ ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n✅ Serveur sur http://0.0.0.0:${port}`);
  console.log(`📍 Route API: GET /api/scrape`);
  console.log(`💡 CTRL+C pour arrêter\n`);
});