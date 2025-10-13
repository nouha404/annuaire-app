import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import * as XLSX from 'xlsx';
import { scrape, ScraperRow } from './api/scraper';

const app = express();

app.use(cors());
app.use(express.json());

const distFolder = path.join(process.cwd(), 'dist/annuaire-app/browser');
app.use(express.static(distFolder));

function toCsv(rows: ScraperRow[]): string {
  const cols = ['nom', 'adresse', 'telephone', 'email', 'site', 'region', 'latitude', 'longitude', 'url'];
  const esc = (s: any) => 
    `"${String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ').trim()}"`;
  
  const head = cols.join(',');
  const body = rows.map(r => cols.map(c => esc((r as any)[c])).join(',')).join('\n');
  
  return `${head}\n${body}`;
}

app.get('/api/scrape', async (req: Request, res: Response) => {
  const what = String(req.query['what'] || '').trim();
  const where = String(req.query['where'] || '').trim();
  const format = String(req.query['format'] || 'json').toLowerCase();
  const maxPages = Math.max(1, Math.min(10, Number(req.query['maxPages']) || 5));

  console.log('\n🎯 Nouvelle requête:');
  console.log(`   what: "${what}"`);
  console.log(`   where: "${where}"`);
  console.log(`   format: ${format}`);
  console.log(`   maxPages: ${maxPages}`);

  if (!what) {
    return res.status(400).json({ error: 'Paramètre "what" requis' });
  }

  try {
    const startTime = Date.now();
    const rows = await scrape(what, where, maxPages);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`⏱️  Terminé en ${duration}s`);
    console.log(`📊 ${rows.length} résultats`);

    if (format === 'csv') {
      const csv = toCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="annuaire_${what.replace(/\s+/g, '_')}.csv"`
      );
      return res.send('\ufeff' + csv);
    }

    if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(rows);
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

    res.json({ count: rows.length, rows, duration: `${duration}s` });

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

const port = Number(process.env['PORT'] || 3000);
app.listen(port, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  🚀 SERVEUR SCRAPER SERVICE-PUBLIC    ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n✅ Serveur sur http://localhost:${port}`);
  console.log(`📍 Route API: GET /api/scrape`);
  console.log(`💡 CTRL+C pour arrêter\n`);
});