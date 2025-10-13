const isVercel = !!process.env['VERCEL']; 
// api/scrape.ts
type VercelRequest = import('http').IncomingMessage & { query: Record<string, any> };
type VercelResponse = import('http').ServerResponse & {
  send: (body: any) => void;
  status: (code: number) => VercelResponse;
  json: (obj: any) => void;
  setHeader: (name: string, value: string) => void;
};


import axios from 'axios';
import * as cheerio from 'cheerio';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import XLSX from 'xlsx';

const BASE = 'https://lannuaire.service-public.gouv.fr';
const UA =
  'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Mobile Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildSearchURL(what: string, where?: string, page?: number) {
  const params = new URLSearchParams();
  params.set('whoWhat', what);
  if (where) params.set('where', where);
  if (page && page > 1) params.set('page', String(page));
  return `${BASE}/recherche?${params.toString()}`;
}

async function parseResultsHTML(html: string) {
  const $ = cheerio.load(html);
  const links: string[] = [];

  $('a.fr-link[data-test="searchResult-link"]').each((_, a) => {
    const href = $(a).attr('href');
    if (href) links.push(href.startsWith('http') ? href : `${BASE}${href}`); // <-- plus d'antislash
  });

  const hasNext =
    $('button#btn-next20, button[data-test="pagerSearchAnnuaire"], a[rel="next"]').length > 0;

  return { links, hasNext };
}

async function parseDetail(url: string) {
  const { data: html } = await axios.get(url, { headers: { 'user-agent': UA } });
  const $ = cheerio.load(html);

  const nom = $('h1').first().text().trim() || $('title').text().trim();

  const addressEl = $('address').first();
  let adresse = '';
  if (addressEl.length) adresse = addressEl.text().replace(/\s{2,}/g, ' ').trim();
  else adresse = $('li:contains(France)').first().text().trim();

  const tel = $('a[href^="tel:"]').first().text().replace(/\s+/g, ' ').trim() || undefined;

  let site: string | undefined;
  $('a[href^="http"]').each((_, a) => {
    const href = $(a).attr('href')!;
    if (!href.includes('service-public.gouv.fr')) {
      site = href;
      return false;
    }
  });

  const region = $('nav[aria-label="breadcrumb"] a').eq(1).text().trim() || undefined;

  return { nom, url, adresse: adresse || undefined, telephone: tel, site, region };
}

async function crawlCheerio(what: string, where?: string, maxPages = 10) {
  const detailLinks: string[] = [];
  let page = 1;

  while (page <= maxPages) {
    const url = buildSearchURL(what, where, page);
    const { data: html } = await axios.get(url, { headers: { 'user-agent': UA } });
    const { links, hasNext } = await parseResultsHTML(html);
    detailLinks.push(...links);
    if (!hasNext) break;
    page++;
    await sleep(800);
  }
  return detailLinks;
}

async function crawlWithPuppeteer(what: string, where?: string, maxClicks = 15) {
  const executablePath = await chromium.executablePath();

  // ➜ on met des valeurs explicites (plus simple que de taper dans les types de chromium)
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true, // puppeteer v22 accepte boolean ou 'new'
    defaultViewport: { width: 1280, height: 800 }
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(buildSearchURL(what, where), { waitUntil: 'domcontentloaded' });

    const allLinks = new Set<string>();

    const collect = async () => {
      const items = await page.$$eval('a.fr-link[data-test="searchResult-link"]', (as) =>
        as.map((a) => (a as HTMLAnchorElement).href)
      );
      items.forEach((u) => allLinks.add(u));
    };

    await collect();

    for (let i = 0; i < maxClicks; i++) {
      const btn = await page.$('button#btn-next20, button[data-test="pagerSearchAnnuaire"]');
      if (!btn) break;

      await Promise.all([
        page.click('button#btn-next20, button[data-test="pagerSearchAnnuaire"]'),
        page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {})
      ]);

      await collect();
      await sleep(300);
    }

    return Array.from(allLinks);
  } finally {
    await browser.close();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { what, where, format } = req.query as { what: string; where?: string; format?: string };
    if (!what) return res.status(400).json({ error: 'Paramètre "what" requis' });

    let links: string[] = [];
    try {
      links = await crawlCheerio(what, where);
    } catch {
      /* ignore */
    }
      if (!links.length && isVercel) {
      links = await crawlWithPuppeteer(what, where);
    }

    const rows: any[] = [];
    for (const u of links) {
      try {
        rows.push(await parseDetail(u));
        await sleep(500);
      } catch {
        /* skip fiche en erreur */
      }
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
      res.setHeader('Content-Disposition', `attachment; filename="annuaire_${what}.xlsx"`);
      return res.send(buf);
    }

    return res.status(200).json({ count: rows.length, rows });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Erreur serveur' });
  }
}
/**
 * ng serve --proxy-config proxy.conf.json

 */