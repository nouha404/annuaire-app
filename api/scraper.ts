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

function buildURL(what: string, where: string): string {
  const params = new URLSearchParams();
  params.set('whoWhat', what);
  if (where) params.set('where', where);
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
    '--disable-setuid-sandbox',
    '--disable-software-rasterizer',
    '--disable-blink-features=AutomationControlled',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  );

  const chromeBin = process.env['CHROME_BIN'];
  if (chromeBin) {
    options.setChromeBinaryPath(chromeBin);
  }

  const driver = await new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(options)
    .build();

  // Anti-détection
  await driver.executeScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  `);

  return driver;
}

async function getAllOrganismUrls(driver: WebDriver): Promise<string[]> {
  const urlsSet = new Set<string>();
  let clickCount = 0;
  const maxClicks = 100;
  let noNewResultsCount = 0;

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  📜 RÉCUPÉRATION DE TOUS LES LIENS    ║');
  console.log('╚════════════════════════════════════════╝\n');

  while (clickCount < maxClicks) {
    console.log(`📍 Itération ${clickCount + 1}:`);

    const previousCount = urlsSet.size;

    try {
      const links = await driver.findElements(
        By.css('a.fr-link[data-test="searchResult-link"]')
      );
      
      console.log(`   → ${links.length} liens visibles sur la page`);

      for (const link of links) {
        try {
          const href = await link.getAttribute('href');
          if (href && href.trim().length > 0) {
            urlsSet.add(href);
          }
        } catch (e) {}
      }

      console.log(`   → ${urlsSet.size} liens uniques collectés au total`);
    } catch (e) {
      console.error('   ❌ Erreur lors de la récupération des liens:', (e as Error).message);
      break;
    }

    const newLinksAdded = urlsSet.size - previousCount;
    console.log(`   → ${newLinksAdded} nouveaux liens ajoutés`);

    if (newLinksAdded === 0) {
      noNewResultsCount++;
      console.log(`   ⚠️ Aucun nouveau lien (${noNewResultsCount}/3)`);
      
      if (noNewResultsCount >= 3) {
        console.log('\n✅ Aucun nouveau résultat après 3 tentatives - Fin\n');
        break;
      }
    } else {
      noNewResultsCount = 0;
    }

    console.log('   🔍 Recherche du bouton "Suivant"...');
    
    let nextButtons = await driver.findElements(
      By.css('button#btn-next20[data-test="pagerSearchAnnuaire"]')
    );

    console.log(`   → ${nextButtons.length} bouton(s) "Suivant" trouvé(s)`);

    if (nextButtons.length === 0) {
      console.log('\n✅ Plus de bouton "Suivant" - Fin de la pagination\n');
      break;
    }

    try {
      const button = nextButtons[0];
      
      await driver.executeScript('arguments[0].scrollIntoView({block: "center", behavior: "smooth"});', button);
      await driver.sleep(1000);

      const isDisplayed = await button.isDisplayed();
      const isEnabled = await button.isEnabled();

      console.log(`   → Bouton visible: ${isDisplayed}, activé: ${isEnabled}`);

      if (!isDisplayed || !isEnabled) {
        console.log('\n⚠️ Bouton non cliquable - Fin de la pagination\n');
        break;
      }

      console.log('   ⏳ Clic sur le bouton...');

      await driver.executeScript('arguments[0].click();', button);
      
      console.log('   ✅ Clic effectué, attente du chargement...');

      await driver.sleep(3000);

      try {
        await driver.wait(async () => {
          const currentLinks = await driver.findElements(
            By.css('a.fr-link[data-test="searchResult-link"]')
          );
          return currentLinks.length > 0;
        }, 5000);
      } catch (e) {
        console.log('   ⚠️ Timeout en attendant les nouveaux résultats');
      }

      clickCount++;

    } catch (e) {
      console.error('   ❌ Erreur lors du clic:', (e as Error).message);
      
      if (clickCount < 2) {
        await driver.sleep(2000);
        clickCount++;
        continue;
      }
      break;
    }
  }

  const allUrls = Array.from(urlsSet);

  console.log('╔════════════════════════════════════════╗');
  console.log(`║  ✅ TOTAL: ${allUrls.length} LIENS COLLECTÉS       ║`);
  console.log('╚════════════════════════════════════════╝\n');

  return allUrls;
}

async function scrapeDetailPage(driver: WebDriver, url: string): Promise<ScraperRow> {
  try {
    await driver.get(url);
  } catch (e) {
    console.log('   ⚠️ Erreur chargement URL');
  }
  
  try {
    await driver.wait(until.elementLocated(By.css('body')), 10000);
  } catch (e) {
    console.log('   ⚠️ Timeout body');
  }
  
  await driver.sleep(2000);
  
  try {
    await driver.wait(async () => {
      const readyState = await driver.executeScript('return document.readyState');
      return readyState === 'complete';
    }, 5000);
  } catch (e) {
    console.log('   ⚠️ Document pas complètement chargé');
  }

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
    try {
      const titleEl = await driver.findElement(By.id('titlePage'));
      const text = (await titleEl.getText()).trim();
      if (text && text.length > 2) data.nom = text;
    } catch (e) {}

    if (!data.nom) {
      try {
        const h1 = await driver.findElement(By.css('h1'));
        const text = (await h1.getText()).trim();
        if (text && text.length > 2) data.nom = text;
      } catch (e) {}
    }

    if (!data.nom) {
      try {
        const pageTitle = await driver.getTitle();
        const text = pageTitle
          .replace(' - Service-Public.fr', '')
          .replace('Service-Public.fr', '')
          .trim();
        if (text && text.length > 2) data.nom = text;
      } catch (e) {}
    }

    if (!data.nom) {
      const urlParts = url.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      data.nom = `Organisme-${lastPart.substring(0, 8)}`;
    }

  } catch (e) {
    const urlParts = url.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    data.nom = `Organisme-${lastPart.substring(0, 8)}`;
  }

  // ADRESSE
  try {
    const addrParts: string[] = [];
    
    try {
      const addrElements = await driver.findElements(
        By.css('[itemprop="streetAddress"], [itemprop="postalCode"], [itemprop="addressLocality"]')
      );
      
      for (const el of addrElements) {
        const text = (await el.getText()).trim();
        if (text) addrParts.push(text);
      }
    } catch (e) {}

    if (addrParts.length === 0) {
      try {
        const addrEl = await driver.findElement(
          By.css('[class*="address"], [class*="adresse"], .fr-address')
        );
        const text = (await addrEl.getText()).trim();
        if (text) addrParts.push(text);
      } catch (e) {}
    }
    
    data.adresse = addrParts.join(' ').replace(/\s+/g, ' ').trim();
  } catch (e) {}

  // TÉLÉPHONE
  try {
    try {
      const telLink = await driver.findElement(By.css('a[href^="tel:"]'));
      data.telephone = (await telLink.getText()).trim();
    } catch (e) {}

    if (!data.telephone) {
      try {
        const bodyText = await driver.findElement(By.css('body')).getText();
        const telMatch = bodyText.match(/0[1-9](?:[\s.-]?\d{2}){4}/);
        if (telMatch) {
          data.telephone = telMatch[0].trim();
        }
      } catch (e) {}
    }
  } catch (e) {}

  // EMAIL
  try {
    const emailLink = await driver.findElement(
      By.css('a.send-mail, a[href^="mailto:"]')
    );
    const href = await emailLink.getAttribute('href');
    
    if (href && href.startsWith('mailto:')) {
      const email = href.replace('mailto:', '').split('?')[0].trim();
      if (email && email.includes('@')) {
        data.email = email;
      }
    }
  } catch (e) {}

  // SITE WEB
  try {
    const siteLink = await driver.findElement(By.css('a[itemprop="url"]'));
    data.site = (await siteLink.getAttribute('href')).trim();
  } catch (e) {
    try {
      const links = await driver.findElements(By.css('a[href^="http"]'));
      for (const link of links) {
        const href = await link.getAttribute('href');
        if (href && !href.includes('service-public.gouv.fr') && !href.includes('legifrance')) {
          data.site = href;
          break;
        }
      }
    } catch (e) {}
  }

  // GPS
  try {
    const mapLink = await driver.findElement(
      By.css('a[data-test="link-voir-sur-une-carte"], a[href*="openstreetmap"], a[href*="google.com/maps"]')
    );
    const href = await mapLink.getAttribute('href');
    
    const latMatch = href.match(/mlat=([\d.]+)/);
    const lonMatch = href.match(/mlon=([\d.]+)/);
    
    if (latMatch) data.latitude = latMatch[1];
    if (lonMatch) data.longitude = lonMatch[1];
  } catch (e) {}

  // RÉGION
  try {
    const breadcrumbs = await driver.findElements(
      By.css('.fr-breadcrumb__link')
    );
    
    if (breadcrumbs.length >= 3) {
      data.region = (await breadcrumbs[2].getText()).trim();
    }
  } catch (e) {}

  return data;
}

export async function scrape(
  what: string, 
  where = '', 
  maxPages = 999
): Promise<ScraperRow[]> {
  const driver = await createDriver();
  const allRows: ScraperRow[] = [];
  const startTime = Date.now();

  try {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   🔍 SCRAPING SERVICE-PUBLIC.FR       ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`   Recherche: "${what}"`);
    console.log(`   Localisation: "${where || 'France entière'}"\n`);
    
    const searchUrl = buildURL(what, where);
    console.log(`📍 URL: ${searchUrl}\n`);
    
    await driver.get(searchUrl);
    
    try {
      await driver.wait(
        until.elementsLocated(By.css('a.fr-link[data-test="searchResult-link"]')),
        10000
      );
    } catch (e) {
      console.log('❌ Aucun résultat trouvé\n');
      return [];
    }

    const allUrls = await getAllOrganismUrls(driver);

    if (allUrls.length === 0) {
      console.log('❌ Aucun lien collecté\n');
      return [];
    }

    console.log('╔════════════════════════════════════════╗');
    console.log('║   📥 SCRAPING DES DÉTAILS             ║');
    console.log('╚════════════════════════════════════════╝\n');

    for (let i = 0; i < allUrls.length; i++) {
      const progress = `[${i + 1}/${allUrls.length}]`;
      const percentage = Math.round(((i + 1) / allUrls.length) * 100);
      
      console.log(`${progress} (${percentage}%) ${allUrls[i]}`);
      
      try {
        const row = await scrapeDetailPage(driver, allUrls[i]);
        allRows.push(row);
        console.log(`   ✅ Ajouté: ${row.nom}`);
      } catch (e) {
        console.error(`   ❌ Erreur: ${(e as Error).message}`);
        const urlParts = allUrls[i].split('/');
        const lastPart = urlParts[urlParts.length - 1];
        allRows.push({
          url: allUrls[i],
          nom: `Erreur-${lastPart?.substring(0, 8) || 'inconnu'}`,
          adresse: '',
          telephone: '',
          email: '',
          site: '',
          region: '',
          latitude: '',
          longitude: ''
        });
      }

      // Pause tous les 10 résultats
      if ((i + 1) % 10 === 0 && i + 1 < allUrls.length) {
        console.log(`   ⏸️  Pause (${i + 1}/${allUrls.length} traités)\n`);
        await driver.sleep(3000);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   ✅ SCRAPING TERMINÉ                 ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`   Résultats: ${allRows.length} organismes`);
    console.log(`   Durée: ${duration}s\n`);

    return allRows;

  } catch (error) {
    console.error('\n❌ Erreur globale:', error);
    throw error;
  } finally {
    await driver.quit();
  }
}