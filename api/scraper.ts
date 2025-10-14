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
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  );

  const chromeBin = process.env['CHROME_BIN'];
  if (chromeBin) {
    options.setChromeBinaryPath(chromeBin);
  }

  return await new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(options)
    .build();
}

async function getAllOrganismUrls(driver: WebDriver): Promise<string[]> {
  const allUrls: string[] = [];
  let clickCount = 0;
  const maxClicks = 20; // Limite de sécurité
  let previousLinkCount = 0; // AJOUTÉ

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  📜 RÉCUPÉRATION DE TOUS LES LIENS    ║');
  console.log('╚════════════════════════════════════════╝\n');

  while (clickCount < maxClicks) {
    console.log(`📍 Itération ${clickCount + 1}:`);

    // Récupérer les liens actuellement visibles
    let currentLinkCount = 0; // AJOUTÉ
    try {
      const links = await driver.findElements(
        By.css('a.fr-link[data-test="searchResult-link"]')
      );
      
      currentLinkCount = links.length; // AJOUTÉ
      console.log(`   → ${links.length} liens visibles sur la page`);

      // Extraire les URLs
      for (const link of links) {
        try {
          const href = await link.getAttribute('href');
          if (href && !allUrls.includes(href)) {
            allUrls.push(href);
          }
        } catch (e) {
          // Ignorer les erreurs d'éléments obsolètes
        }
      }

      console.log(`   → ${allUrls.length} liens uniques collectés au total`);

    } catch (e) {
      console.error('   ❌ Erreur lors de la récupération des liens:', (e as Error).message);
      break;
    }

    // Chercher le bouton "Afficher les 20 résultats suivants"
    console.log('   🔍 Recherche du bouton "Suivant"...');
    
    const nextButtons = await driver.findElements(
      By.css('button#btn-next20[data-test="pagerSearchAnnuaire"]')
    );

    console.log(`   → ${nextButtons.length} bouton(s) "Suivant" trouvé(s)`);

    if (nextButtons.length === 0) {
      console.log('\n✅ Plus de bouton "Suivant" - Fin de la pagination\n');
      break;
    }

    // Vérifier si le bouton est visible et cliquable
    try {
      const button = nextButtons[0];
      const isDisplayed = await button.isDisplayed();
      const isEnabled = await button.isEnabled();

      console.log(`   → Bouton visible: ${isDisplayed}, activé: ${isEnabled}`);

      if (!isDisplayed || !isEnabled) {
        console.log('\n⚠️ Bouton non cliquable - Fin de la pagination\n');
        break;
      }

      // Scroll jusqu'au bouton
      await driver.executeScript('arguments[0].scrollIntoView({block: "center"});', button);
      await driver.sleep(500);

      console.log('   ⏳ Clic sur le bouton...');

      // Cliquer avec JavaScript (plus fiable)
      await driver.executeScript('arguments[0].click();', button);
      
      console.log('   ✅ Clic effectué, attente du chargement...\n');

      // Attendre que de nouveaux résultats se chargent
      await driver.sleep(3000);

      // Vérifier que de nouveaux liens sont apparus
      const newLinks = await driver.findElements(
        By.css('a.fr-link[data-test="searchResult-link"]')
      );

      // CORRIGÉ : Utiliser currentLinkCount au lieu de links.length
      if (newLinks.length === currentLinkCount) {
        console.log('⚠️ Aucun nouveau résultat chargé - Fin possible\n');
        
        // Essayer encore une fois au cas où
        if (clickCount < 2) {
          await driver.sleep(2000);
          clickCount++;
          continue;
        }
        break;
      }

      previousLinkCount = currentLinkCount; // AJOUTÉ
      clickCount++;

    } catch (e) {
      console.error('   ❌ Erreur lors du clic:', (e as Error).message);
      break;
    }
  }

  console.log('╔════════════════════════════════════════╗');
  console.log(`║  ✅ TOTAL: ${allUrls.length} LIENS COLLECTÉS       ║`);
  console.log('╚════════════════════════════════════════╝\n');

  return allUrls;
}

async function scrapeDetailPage(driver: WebDriver, url: string): Promise<ScraperRow> {
  await driver.get(url);
  await driver.sleep(600);

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
    // Ignorer
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
    // Ignorer
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
    
    if (href && href.startsWith('mailto:')) {
      const email = href.replace('mailto:', '').split('?')[0].trim();
      if (email && email.includes('@')) {
        data.email = email;
      }
    }
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
    
    // Attendre les résultats
    try {
      await driver.wait(
        until.elementsLocated(By.css('a.fr-link[data-test="searchResult-link"]')),
        10000
      );
    } catch (e) {
      console.log('❌ Aucun résultat trouvé\n');
      return [];
    }

    // Récupérer TOUS les liens
    const allUrls = await getAllOrganismUrls(driver);

    if (allUrls.length === 0) {
      console.log('❌ Aucun lien collecté\n');
      return [];
    }

    // Scraper chaque URL
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
      } catch (e) {
        console.error(`   ❌ Erreur: ${(e as Error).message}`);
        allRows.push({
          url: allUrls[i],
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

      // Pause tous les 20 pour éviter la surcharge
      if ((i + 1) % 20 === 0) {
        console.log(`   ⏸️  Pause (${i + 1}/${allUrls.length} traités)\n`);
        await driver.sleep(2000);
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