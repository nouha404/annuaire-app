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
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '--disable-images', // ⚡ Pas de chargement d'images
    '--disable-css' // ⚡ Pas de CSS
  );

  const chromeBin = process.env['CHROME_BIN'];
  if (chromeBin) {
    options.setChromeBinaryPath(chromeBin);
  }

  const driver = await new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(options)
    .build();

  // Anti-détection (rapide)
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

      // ⚡ Extraction parallèle des hrefs
      const hrefs = await Promise.all(
        links.map(async (link) => {
          try {
            return await link.getAttribute('href');
          } catch (e) {
            return null;
          }
        })
      );

      hrefs.forEach(href => {
        if (href && href.trim().length > 0) {
          urlsSet.add(href);
        }
      });

      console.log(`   → ${urlsSet.size} liens uniques collectés au total`);
    } catch (e) {
      console.error('   ❌ Erreur lors de la récupération des liens:', (e as Error).message);
      break;
    }

    const newLinksAdded = urlsSet.size - previousCount;
    console.log(`   → ${newLinksAdded} nouveaux liens ajoutés`);

    if (newLinksAdded === 0) {
      noNewResultsCount++;
      console.log(`   ⚠️ Aucun nouveau lien (${noNewResultsCount}/2)`);
      
      if (noNewResultsCount >= 2) { // ⚡ Réduit de 3 à 2
        console.log('\n✅ Aucun nouveau résultat après 2 tentatives - Fin\n');
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
      
      await driver.executeScript('arguments[0].scrollIntoView({block: "center", behavior: "auto"});', button);
      await driver.sleep(300); // ⚡ Réduit de 1000 à 300

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

      await driver.sleep(800); // ⚡ Réduit de 3000 à 800

      // ⚡ Timeout réduit pour l'attente des résultats
      try {
        await driver.wait(async () => {
          const currentLinks = await driver.findElements(
            By.css('a.fr-link[data-test="searchResult-link"]')
          );
          return currentLinks.length > 0;
        }, 3000); // ⚡ Réduit de 5000 à 3000
      } catch (e) {
        console.log('   ⚠️ Timeout en attendant les nouveaux résultats');
      }

      clickCount++;

    } catch (e) {
      console.error('   ❌ Erreur lors du clic:', (e as Error).message);
      
      if (clickCount < 2) {
        await driver.sleep(500); // ⚡ Réduit de 2000 à 500
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
  
  // ⚡ Timeout réduit
  try {
    await driver.wait(until.elementLocated(By.css('body')), 5000); // ⚡ Réduit de 10000 à 5000
  } catch (e) {
    console.log('   ⚠️ Timeout body');
  }
  
  await driver.sleep(500); // ⚡ Réduit de 2000 à 500
  
  // ⚡ On skip le wait sur document.readyState pour gagner du temps
  
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

  // ⚡ Extraction parallèle de tous les champs
  const [nomResult, adresseResult, telephoneResult, emailResult, siteResult, regionResult, gpsResult] = await Promise.all([
    // NOM
    (async () => {
      try {
        const titleEl = await driver.findElement(By.id('titlePage'));
        return (await titleEl.getText()).trim();
      } catch (e) {
        try {
          const h1 = await driver.findElement(By.css('h1'));
          return (await h1.getText()).trim();
        } catch (e) {
          try {
            const pageTitle = await driver.getTitle();
            return pageTitle.replace(' - Service-Public.fr', '').replace('Service-Public.fr', '').trim();
          } catch (e) {
            const urlParts = url.split('/');
            const lastPart = urlParts[urlParts.length - 1];
            return `Organisme-${lastPart.substring(0, 8)}`;
          }
        }
      }
    })(),
    
    // ADRESSE
    (async () => {
      try {
        const addrElements = await driver.findElements(
          By.css('[itemprop="streetAddress"], [itemprop="postalCode"], [itemprop="addressLocality"]')
        );
        
        const addrParts = await Promise.all(
          addrElements.map(async (el) => {
            try {
              return (await el.getText()).trim();
            } catch (e) {
              return '';
            }
          })
        );
        
        return addrParts.filter(p => p).join(' ').replace(/\s+/g, ' ').trim();
      } catch (e) {
        return '';
      }
    })(),
    
    // TÉLÉPHONE
    (async () => {
      try {
        const telLink = await driver.findElement(By.css('a[href^="tel:"]'));
        return (await telLink.getText()).trim();
      } catch (e) {
        return '';
      }
    })(),
    
    // EMAIL
    (async () => {
      try {
        const emailLink = await driver.findElement(By.css('a.send-mail, a[href^="mailto:"]'));
        const href = await emailLink.getAttribute('href');
        
        if (href && href.startsWith('mailto:')) {
          const email = href.replace('mailto:', '').split('?')[0].trim();
          if (email && email.includes('@')) {
            return email;
          }
        }
        return '';
      } catch (e) {
        return '';
      }
    })(),
    
    // SITE WEB
    (async () => {
      try {
        const siteLink = await driver.findElement(By.css('a[itemprop="url"]'));
        return (await siteLink.getAttribute('href')).trim();
      } catch (e) {
        return '';
      }
    })(),
    
    // RÉGION
    (async () => {
      try {
        const breadcrumbs = await driver.findElements(By.css('.fr-breadcrumb__link'));
        if (breadcrumbs.length >= 3) {
          return (await breadcrumbs[2].getText()).trim();
        }
        return '';
      } catch (e) {
        return '';
      }
    })(),
    
    // GPS
    (async () => {
      try {
        const mapLink = await driver.findElement(
          By.css('a[data-test="link-voir-sur-une-carte"], a[href*="openstreetmap"], a[href*="google.com/maps"]')
        );
        const href = await mapLink.getAttribute('href');
        
        const latMatch = href.match(/mlat=([\d.]+)/);
        const lonMatch = href.match(/mlon=([\d.]+)/);
        
        return {
          latitude: latMatch ? latMatch[1] : '',
          longitude: lonMatch ? lonMatch[1] : ''
        };
      } catch (e) {
        return { latitude: '', longitude: '' };
      }
    })()
  ]);

  data.nom = nomResult;
  data.adresse = adresseResult;
  data.telephone = telephoneResult;
  data.email = emailResult;
  data.site = siteResult;
  data.region = regionResult;
  data.latitude = gpsResult.latitude;
  data.longitude = gpsResult.longitude;

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
        5000 // ⚡ Réduit de 10000 à 5000
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

    // ⚡ SCRAPING PARALLÈLE PAR BATCH DE 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < allUrls.length; i += BATCH_SIZE) {
      const batch = allUrls.slice(i, Math.min(i + BATCH_SIZE, allUrls.length));
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allUrls.length / BATCH_SIZE);
      
      console.log(`\n🔄 Batch ${batchNum}/${totalBatches} (${batch.length} URLs)`);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (url, idx) => {
          const globalIdx = i + idx;
          const progress = `[${globalIdx + 1}/${allUrls.length}]`;
          const percentage = Math.round(((globalIdx + 1) / allUrls.length) * 100);
          
          console.log(`${progress} (${percentage}%) ${url.substring(0, 60)}...`);
          
          try {
            // ⚡ Créer un driver par URL pour vraie parallélisation
            const tempDriver = await createDriver();
            try {
              const row = await scrapeDetailPage(tempDriver, url);
              console.log(`   ✅ ${row.nom}`);
              return row;
            } finally {
              await tempDriver.quit();
            }
          } catch (e) {
            console.error(`   ❌ Erreur: ${(e as Error).message}`);
            const urlParts = url.split('/');
            const lastPart = urlParts[urlParts.length - 1];
            return {
              url,
              nom: `Erreur-${lastPart?.substring(0, 8) || 'inconnu'}`,
              adresse: '',
              telephone: '',
              email: '',
              site: '',
              region: '',
              latitude: '',
              longitude: ''
            };
          }
        })
      );

      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          allRows.push(result.value);
        }
      });

      // ⚡ Micro-pause entre les batchs
      if (i + BATCH_SIZE < allUrls.length) {
        await driver.sleep(500); // ⚡ Réduit de 3000 à 500
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