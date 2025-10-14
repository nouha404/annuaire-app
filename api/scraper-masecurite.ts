import { Builder, Browser, By, until, WebDriver, WebElement } from 'selenium-webdriver';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome';

const BASE = 'https://www.masecurite.interieur.gouv.fr/fr/trouver-un-commissariat-une-gendarmerie';

export interface MaSecuriteRow {
  nom: string;
  adresse: string;
  telephone: string;
  statut: string;
  type: string;
  ville: string;
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

// Scroll infini pour charger tous les résultats
async function scrollToLoadAll(driver: WebDriver): Promise<void> {
  console.log('   📜 Chargement de tous les résultats (scroll infini)...');
  
  let previousCount = 0;
  let stableCount = 0;
  const maxScrolls = 100; // Limite de sécurité

  for (let i = 0; i < maxScrolls; i++) {
    // Scroll vers le bas de la liste
    await driver.executeScript(`
      const container = document.querySelector('.fr-modal__content') || document.body;
      container.scrollTo(0, container.scrollHeight);
    `);
    
    await driver.sleep(1500); // Attendre le chargement

    // Compter les établissements
    const items = await driver.findElements(
      By.css('article.fr-card, div.fr-card, [role="article"]')
    );
    const currentCount = items.length;

    console.log(`      Scroll ${i + 1}: ${currentCount} établissements`);

    if (currentCount === previousCount) {
      stableCount++;
      if (stableCount >= 3) {
        console.log('   ✅ Tous les résultats chargés');
        break;
      }
    } else {
      stableCount = 0;
    }

    previousCount = currentCount;
  }
}

async function scrapeAllResults(driver: WebDriver): Promise<MaSecuriteRow[]> {
  const results: MaSecuriteRow[] = [];

  try {
    // Attendre que les résultats apparaissent
    await driver.wait(
      until.elementsLocated(By.css('article, [role="article"]')),
      15000
    );

    await driver.sleep(2000);

    // Scroll pour charger tout
    await scrollToLoadAll(driver);

    // Récupérer tous les articles
    const articles = await driver.findElements(
      By.css('article.fr-card, article, div.fr-card')
    );
    
    console.log(`   → ${articles.length} établissements trouvés\n`);

    for (let i = 0; i < articles.length; i++) {
      try {
        const article = articles[i];

        const data: MaSecuriteRow = {
          nom: '',
          adresse: '',
          telephone: '',
          statut: '',
          type: '',
          ville: ''
        };

        // NOM
        try {
          const titleElements = await article.findElements(By.css('h3, .fr-card__title, [class*="title"]'));
          if (titleElements.length > 0) {
            data.nom = (await titleElements[0].getText()).trim();
            
            if (data.nom.toLowerCase().includes('commissariat')) {
              data.type = 'Commissariat';
            } else if (data.nom.toLowerCase().includes('gendarmerie')) {
              data.type = 'Gendarmerie';
            } else if (data.nom.toLowerCase().includes('brigade')) {
              data.type = 'Brigade';
            }
          }
        } catch (e) {
          // Ignorer
        }

        // ADRESSE
        try {
          const addressElements = await article.findElements(
            By.css('.fr-card__desc, [class*="address"], [class*="adresse"], p')
          );
          
          for (const el of addressElements) {
            const text = (await el.getText()).trim();
            // Vérifier si c'est une adresse (contient un code postal)
            if (text && /\d{5}/.test(text)) {
              data.adresse = text;
              
              // Extraire la ville
              const match = text.match(/\d{5}\s+(.+?)(?:\n|$)/);
              if (match) {
                data.ville = match[1].trim();
              }
              break;
            }
          }
        } catch (e) {
          // Ignorer
        }

        // STATUT (Ouvert/Fermé)
        try {
          const badges = await article.findElements(By.css('.fr-badge, [class*="badge"]'));
          for (const badge of badges) {
            const text = (await badge.getText()).trim().toLowerCase();
            if (text.includes('ouvert') || text.includes('fermé')) {
              data.statut = (await badge.getText()).trim();
              break;
            }
          }
        } catch (e) {
          // Pas de statut
        }

        // TÉLÉPHONE
        try {
          const telLinks = await article.findElements(By.css('a[href^="tel:"]'));
          if (telLinks.length > 0) {
            data.telephone = (await telLinks[0].getText()).trim();
          }
        } catch (e) {
          // Pas de téléphone
        }

        if (data.nom && data.nom.length > 3) {
          results.push(data);
          if ((i + 1) % 50 === 0) {
            console.log(`   ✅ ${i + 1}/${articles.length} traités`);
          }
        }

      } catch (e) {
        console.error(`   ❌ Erreur article ${i}:`, (e as Error).message);
      }
    }

  } catch (e) {
    console.error('Erreur lors du scraping:', e);
  }

  return results;
}

export async function scrapeMaSecurite(searchTerm: string, location = ''): Promise<MaSecuriteRow[]> {
  const driver = await createDriver();

  try {
    console.log(`\n🔍 MaSécurité - Recherche: "${searchTerm}" à "${location || 'France'}"`);

    await driver.get(BASE);
    await driver.sleep(3000);

    // Chercher le champ de recherche (plusieurs possibilités)
    let searchInput: WebElement | null = null;
    
    try {
      searchInput = await driver.findElement(
        By.css('input[type="search"], input[type="text"], input[placeholder*="adresse"], input[placeholder*="Adresse"]')
      );
    } catch (e) {
      console.log('⚠️ Champ de recherche non trouvé, tentative alternative...');
      const inputs = await driver.findElements(By.css('input'));
      if (inputs.length > 0) {
        searchInput = inputs[0];
      }
    }

    if (!searchInput) {
      console.error('❌ Impossible de trouver le champ de recherche');
      return [];
    }

    await searchInput.clear();
    
    const query = location ? `${searchTerm} ${location}` : searchTerm;
    await searchInput.sendKeys(query);
    await driver.sleep(1000);

    // Chercher le bouton de recherche
    try {
      const searchButton = await driver.findElement(
        By.css('button[type="submit"], button.fr-btn')
      );
      await searchButton.click();
    } catch (e) {
      // Essayer d'appuyer sur Entrée
      await searchInput.sendKeys('\n');
    }

    await driver.sleep(4000); // Attendre les résultats

    // Scraper tous les résultats
    const results = await scrapeAllResults(driver);
    
    console.log(`✅ MaSécurité: ${results.length} établissements trouvés`);
    return results;

  } catch (error) {
    console.error('❌ Erreur MaSécurité:', error);
    return [];
  } finally {
    await driver.quit();
  }
}