import puppeteer, { Browser, Page } from 'puppeteer';

const BASE = 'https://lannuaire.service-public.gouv.fr';

export interface ScraperRow {
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  site: string;
  region: string;
  latitude: string;
  longitude: string;
  url: string;
}

function buildURL(what: string, where: string, page?: number): string {
  const params = new URLSearchParams();
  params.set('whoWhat', what);
  if (where) params.set('where', where);
  if (page && page > 1) params.set('page', String(page));
  return `${BASE}/recherche?${params.toString()}`;
}

async function createBrowser(): Promise<Browser> {
  return await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions'
    ]
  });
}

async function getOrganismUrls(page: Page): Promise<string[]> {
  const urls: string[] = [];
  
  try {
    const links = await page.$$('a.fr-link[data-test="searchResult-link"]');
    
    for (const link of links) {
      try {
        const href = await link.evaluate(el => el.getAttribute('href'));
        if (href) urls.push(href);
      } catch (e) {
        // Ignorer
      }
    }
  } catch (e) {
    console.error('Erreur récupération URLs:', e);
  }

  return urls;
}

async function scrapeDetailPage(page: Page, url: string): Promise<ScraperRow> {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });
  await new Promise(resolve => setTimeout(resolve, 500));

  const data: ScraperRow = {
    url,
    nom: '',
    adresse: '',
    telephone: '',
    email: '',
    site: '',
    region: '',
    latitude: '',
    longitude: ''
  };

  // NOM
  try {
    data.nom = await page.$eval('#titlePage', el => el.textContent?.trim() || '');
  } catch (e) {
    console.log('⚠️ Nom non trouvé');
  }

  // ADRESSE
  try {
    const addrParts = await page.$$eval(
      '[itemprop="streetAddress"], [itemprop="postalCode"], [itemprop="addressLocality"]',
      elements => elements.map(el => el.textContent?.trim()).filter(Boolean)
    );
    data.adresse = addrParts.join(' ');
  } catch (e) {
    console.log('⚠️ Adresse non trouvée');
  }

  // TÉLÉPHONE
  try {
    data.telephone = await page.$eval('a[href^="tel:"]', el => el.textContent?.trim() || '');
  } catch (e) {
    // Pas de téléphone
  }

  // EMAIL
  try {
    const emailHref = await page.$eval(
      'a.send-mail, a[href^="mailto:"]',
      el => el.getAttribute('href') || ''
    );
    data.email = emailHref.replace('mailto:', '').trim();
  } catch (e) {
    // Pas d'email
  }

  // SITE WEB
  try {
    data.site = await page.$eval('a[itemprop="url"]', el => el.getAttribute('href') || '');
  } catch (e) {
    // Pas de site
  }

  // GPS
  try {
    const mapHref = await page.$eval(
      'a[data-test="link-voir-sur-une-carte"]',
      el => el.getAttribute('href') || ''
    );
    
    const latMatch = mapHref.match(/mlat=([\d.]+)/);
    const lonMatch = mapHref.match(/mlon=([\d.]+)/);
    
    if (latMatch) data.latitude = latMatch[1];
    if (lonMatch) data.longitude = lonMatch[1];
  } catch (e) {
    // Pas de GPS
  }

  // RÉGION
  try {
    const breadcrumbs = await page.$$('.fr-breadcrumb__link');
    if (breadcrumbs.length >= 3) {
      data.region = await breadcrumbs[2].evaluate(el => el.textContent?.trim() || '');
    }
  } catch (e) {
    // Pas de région
  }

  return data;
}

async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextButton = await page.$('button#btn-next20[data-test="pagerSearchAnnuaire"]');
    return nextButton !== null;
  } catch (e) {
    return false;
  }
}

async function clickNext(page: Page): Promise<boolean> {
  try {
    await page.click('button#btn-next20[data-test="pagerSearchAnnuaire"]');
    await new Promise(resolve => setTimeout(resolve, 2000)); 
    return true;
  } catch (e) {
    return false;
  }
}

export async function scrape(
  what: string, 
  where = '', 
  maxPages = 5
): Promise<ScraperRow[]> {
  const browser = await createBrowser();
  const page = await browser.newPage();
  const allRows: ScraperRow[] = [];

  try {
    console.log(`🔍 Recherche: "${what}" à "${where || 'partout'}"`);
    
    await page.goto(buildURL(what, where, 1), { waitUntil: 'networkidle0' });
    
    try {
      await page.waitForSelector('a.fr-link[data-test="searchResult-link"]', { timeout: 10000 });
    } catch (e) {
      console.log('⚠️ Aucun résultat trouvé');
      return [];
    }

    let currentPage = 1;
    
    while (currentPage <= maxPages) {
      console.log(`📄 Scraping page ${currentPage}...`);
      
      const urls = await getOrganismUrls(page);
      console.log(`   → ${urls.length} organismes trouvés`);
      
      for (let i = 0; i < urls.length; i++) {
        console.log(`   → Scraping ${i + 1}/${urls.length}: ${urls[i]}`);
        try {
          const row = await scrapeDetailPage(page, urls[i]);
          allRows.push(row);
        } catch (e) {
          console.error(`   ❌ Erreur sur ${urls[i]}:`, (e as Error).message);
          allRows.push({
            url: urls[i],
            nom: 'Erreur de scraping',
            adresse: '',
            telephone: '',
            email: '',
            site: '',
            region: '',
            latitude: '',
            longitude: ''
          });
        }
      }

      if (currentPage < maxPages) {
        const hasNext = await hasNextPage(page);
        if (!hasNext) {
          console.log('✅ Dernière page atteinte');
          break;
        }

        const clicked = await clickNext(page);
        if (!clicked) {
          console.log('⚠️ Impossible de cliquer sur suivant');
          break;
        }

        await page.waitForSelector('a.fr-link[data-test="searchResult-link"]', { timeout: 10000 });
      }

      currentPage++;
    }

    console.log(`✅ Scraping terminé: ${allRows.length} organismes`);
    return allRows;

  } catch (error) {
    console.error('❌ Erreur globale:', error);
    throw error;
  } finally {
    await browser.close();
  }
}