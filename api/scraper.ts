import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome';

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

async function createDriver(): Promise<WebDriver> {
  const options = new ChromeOptions();
  options.addArguments(
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1920,1080',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  );

  return await new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(options)
    .build();
}

async function getOrganismUrls(driver: WebDriver): Promise<string[]> {
  const urls: string[] = [];
  
  try {
    const links = await driver.findElements(
      By.css('a.fr-link[data-test="searchResult-link"]')
    );

    for (const link of links) {
      try {
        const href = await link.getAttribute('href');
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

async function scrapeDetailPage(driver: WebDriver, url: string): Promise<ScraperRow> {
  await driver.get(url);
  await driver.sleep(1000);

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
    const titleEl = await driver.findElement(By.id('titlePage'));
    data.nom = (await titleEl.getText()).trim();
  } catch (e) {
    console.log('⚠️ Nom non trouvé');
  }

  // ADRESSE
  try {
    const addrParts: string[] = [];
    const addrElements = await driver.findElements(
      By.css('[itemprop="streetAddress"], [itemprop="postalCode"], [itemprop="addressLocality"]')
    );
    
    for (const el of addrElements) {
      const text = (await el.getText()).trim();
      if (text) addrParts.push(text);
    }
    
    data.adresse = addrParts.join(' ');
  } catch (e) {
    console.log('⚠️ Adresse non trouvée');
  }

  // TÉLÉPHONE
  try {
    const telLink = await driver.findElement(By.css('a[href^="tel:"]'));
    data.telephone = (await telLink.getText()).trim();
  } catch (e) {
    // Pas de téléphone
  }

  // EMAIL
  try {
    const emailLink = await driver.findElement(
      By.css('a.send-mail, a[href^="mailto:"]')
    );
    const href = await emailLink.getAttribute('href');
    data.email = href.replace('mailto:', '').trim();
  } catch (e) {
    // Pas d'email
  }

  // SITE WEB
  try {
    const siteLink = await driver.findElement(By.css('a[itemprop="url"]'));
    data.site = (await siteLink.getAttribute('href')).trim();
  } catch (e) {
    // Pas de site
  }

  // GPS
  try {
    const mapLink = await driver.findElement(
      By.css('a[data-test="link-voir-sur-une-carte"]')
    );
    const href = await mapLink.getAttribute('href');
    
    const latMatch = href.match(/mlat=([\d.]+)/);
    const lonMatch = href.match(/mlon=([\d.]+)/);
    
    if (latMatch) data.latitude = latMatch[1];
    if (lonMatch) data.longitude = lonMatch[1];
  } catch (e) {
    // Pas de GPS
  }

  // RÉGION
  try {
    const breadcrumbs = await driver.findElements(
      By.css('.fr-breadcrumb__link')
    );
    
    if (breadcrumbs.length >= 3) {
      data.region = (await breadcrumbs[2].getText()).trim();
    }
  } catch (e) {
    // Pas de région
  }

  return data;
}

async function hasNextPage(driver: WebDriver): Promise<boolean> {
  try {
    const nextButtons = await driver.findElements(
      By.css('button#btn-next20[data-test="pagerSearchAnnuaire"]')
    );
    return nextButtons.length > 0;
  } catch (e) {
    return false;
  }
}

async function clickNext(driver: WebDriver): Promise<boolean> {
  try {
    const nextButton = await driver.findElement(
      By.css('button#btn-next20[data-test="pagerSearchAnnuaire"]')
    );
    await nextButton.click();
    await driver.sleep(2000);
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
  const driver = await createDriver();
  const allRows: ScraperRow[] = [];

  try {
    console.log(`🔍 Recherche: "${what}" à "${where || 'partout'}"`);
    
    await driver.get(buildURL(what, where, 1));
    
    try {
      await driver.wait(
        until.elementsLocated(By.css('a.fr-link[data-test="searchResult-link"]')),
        10000
      );
    } catch (e) {
      console.log('⚠️ Aucun résultat trouvé');
      return [];
    }

    let currentPage = 1;
    
    while (currentPage <= maxPages) {
      console.log(`📄 Scraping page ${currentPage}...`);
      
      const urls = await getOrganismUrls(driver);
      console.log(`   → ${urls.length} organismes trouvés`);
      
      for (let i = 0; i < urls.length; i++) {
        console.log(`   → Scraping ${i + 1}/${urls.length}: ${urls[i]}`);
        try {
          const row = await scrapeDetailPage(driver, urls[i]);
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
        const hasNext = await hasNextPage(driver);
        if (!hasNext) {
          console.log('✅ Dernière page atteinte');
          break;
        }

        const clicked = await clickNext(driver);
        if (!clicked) {
          console.log('⚠️ Impossible de cliquer sur suivant');
          break;
        }

        await driver.wait(
          until.elementsLocated(By.css('a.fr-link[data-test="searchResult-link"]')),
          10000
        );
      }

      currentPage++;
    }

    console.log(`✅ Scraping terminé: ${allRows.length} organismes`);
    return allRows;

  } catch (error) {
    console.error('❌ Erreur globale:', error);
    throw error;
  } finally {
    await driver.quit();
  }
}