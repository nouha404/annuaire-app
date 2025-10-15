import { scrape as scrapeServicePublic, ScraperRow } from './scraper';
import { scrapeMaSecurite, MaSecuriteRow } from './scraper-masecurite';

export interface UnifiedRow {
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
}

function convertServicePublic(rows: ScraperRow[]): UnifiedRow[] {
  return rows.map(r => ({
    source: 'Service-Public',
    nom: r.nom,
    adresse: r.adresse,
    telephone: r.telephone,
    ville: extractVille(r.adresse),
    type: detectType(r.nom),
    region: r.region,
    email: r.email,
    site: r.site,
    url: r.url
  }));
}

function convertMaSecurite(rows: MaSecuriteRow[]): UnifiedRow[] {
  return rows.map(r => ({
    source: 'MaSécurité',
    nom: r.nom,
    adresse: r.adresse,
    telephone: r.telephone,
    ville: r.ville,
    type: r.type,
    statut: r.statut
  }));
}

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
  return 'Autre';
}

function makeKey(row: UnifiedRow): string {
  if (row.url) {
    return row.url;
  }
  const nomNorm = row.nom.toLowerCase().trim().replace(/\s+/g, ' ');
  const addrNorm = row.adresse.toLowerCase().trim().replace(/\s+/g, ' ');
  return `${nomNorm}|${addrNorm}`;
}

function mergeRows(row1: UnifiedRow, row2: UnifiedRow): UnifiedRow {
  return {
    source: `${row1.source} + ${row2.source}`,
    nom: row1.nom || row2.nom,
    adresse: row1.adresse || row2.adresse,
    telephone: row1.telephone || row2.telephone,
    ville: row1.ville || row2.ville,
    type: row1.type || row2.type,
    region: row1.region || row2.region,
    statut: row1.statut || row2.statut,
    email: row1.email || row2.email,
    site: row1.site || row2.site,
    url: row1.url || row2.url
  };
}

export async function scrapeUnified(
  searchTerm: string,
  location = '',
  maxPages = 5
): Promise<UnifiedRow[]> {
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║   🔍 SCRAPING UNIFIÉ (2 SOURCES)     ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log(`   Recherche: "${searchTerm}"`);
  console.log(`   Localisation: "${location || 'France entière'}"`);
  console.log(`   Pages max: ${maxPages}\n`);

  const resultsMap = new Map<string, UnifiedRow>();

  try {
    // =============================================
    // 1. SERVICE-PUBLIC.FR
    // =============================================
    console.log('📍 [1/2] Scraping Service-Public.fr...\n');
    const servicePublicData = await scrapeServicePublic(searchTerm, location, maxPages);
    const servicePublicUnified = convertServicePublic(servicePublicData);
    
    console.log(`   ✅ Service-Public: ${servicePublicUnified.length} résultats\n`);

    for (const row of servicePublicUnified) {
      const key = makeKey(row);
      resultsMap.set(key, row);
    }

    // =============================================
    // 2. MASÉCURITÉ.INTERIEUR.GOV.FR (ACTIVÉ)
    // =============================================
    console.log('📍 [2/2] MaSécurité.interieur.gouv.fr...\n');
    
    // CHANGEMENT ICI : ACTIVÉ au lieu de désactivé
    const maSecuriteData = await scrapeMaSecurite(searchTerm, location);
    const maSecuriteUnified = convertMaSecurite(maSecuriteData);
    
    console.log(`   ✅ MaSécurité: ${maSecuriteUnified.length} résultats\n`);
    
    let duplicatesCount = 0;
    for (const row of maSecuriteUnified) {
      const key = makeKey(row);
      
      if (resultsMap.has(key)) {
        const existing = resultsMap.get(key)!;
        const merged = mergeRows(existing, row);
        resultsMap.set(key, merged);
        duplicatesCount++;
      } else {
        resultsMap.set(key, row);
      }
    }

    const finalResults = Array.from(resultsMap.values());

    // Filtrer les pages bloquées
    const cleanResults = finalResults.filter(row => 
      !row.nom.includes('BLOQUÉ-') && 
      !row.nom.includes('renforce temporairement') &&
      !row.nom.includes('Erreur-')
    );

    const totalFromBoth = servicePublicUnified.length + maSecuriteUnified.length;
    const blockedCount = finalResults.length - cleanResults.length;
    
    console.log('╔═══════════════════════════════════════╗');
    console.log('║          📊 STATISTIQUES FINALES      ║');
    console.log('╚═══════════════════════════════════════╝');
    console.log(`   Service-Public:    ${servicePublicUnified.length} résultats`);
    console.log(`   MaSécurité:        ${maSecuriteUnified.length} résultats`);
    console.log(`   ─────────────────────────────────────`);
    console.log(`   Total brut:        ${totalFromBoth} résultats`);
    console.log(`   Doublons détectés: ${duplicatesCount} résultats`);
    console.log(`   Pages bloquées:    ${blockedCount} résultats`);
    console.log(`   ═════════════════════════════════════`);
    console.log(`   ✅ RÉSULTATS UNIQUES: ${cleanResults.length}\n`);

    return cleanResults;

  } catch (error) {
    console.error('❌ Erreur lors du scraping unifié:', error);
    throw error;
  }
}