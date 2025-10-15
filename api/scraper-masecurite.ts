import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver';
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

// Scraper les résultats après avoir cliqué sur une suggestion
async function scrapeResults(driver: WebDriver): Promise<MaSecuriteRow[]> {
  const results: MaSecuriteRow[] = [];

  try {
    // Attendre que les résultats se chargent
    await driver.sleep(4000);

    // Trouver tous les établissements (plusieurs sélecteurs possibles)
    let items = await driver.findElements(
      By.css('ul.force-point-list li.force-point-list-item, li.force-point-list-item')
    );

    if (items.length === 0) {
      items = await driver.findElements(By.css('li.list-group-item.fr-py-2v'));
    }

    if (items.length === 0) {
      items = await driver.findElements(By.css('article, [role="article"]'));
    }

    console.log(`      → ${items.length} établissement(s) trouvé(s)`);

    for (const item of items) {
      try {
        const data: MaSecuriteRow = {
          nom: '',
          adresse: '',
          telephone: '',
          statut: '',
          type: '',
          ville: ''
        };

        // NOM - chercher h2 ou h3
        try {
          let titleElement = await item.findElements(By.css('h2'));
          if (titleElement.length === 0) {
            titleElement = await item.findElements(By.css('h3'));
          }
          if (titleElement.length === 0) {
            titleElement = await item.findElements(By.css('.point-label, .fr-text--md'));
          }

          if (titleElement.length > 0) {
            data.nom = (await titleElement[0].getText()).trim();

            const nomLower = data.nom.toLowerCase();
            if (nomLower.includes('commissariat')) {
              data.type = 'Commissariat';
            } else if (nomLower.includes('gendarmerie')) {
              data.type = 'Gendarmerie';
            } else if (nomLower.includes('brigade')) {
              data.type = 'Brigade';
            } else if (nomLower.includes('poste')) {
              data.type = 'Poste de police';
            } else {
              data.type = 'Service de sécurité';
            }
          }
        } catch (e) {}

        // ADRESSE - chercher dans tous les divs
        try {
          const allText = await item.getText();
          const lines = allText.split('\n');
          
          for (const line of lines) {
            if (line && /\d{5}/.test(line) && !line.toLowerCase().includes('tél') && line.length < 200) {
              data.adresse = line.trim();
              
              // Extraire ville
              const match = line.match(/\d{5}\s+(.+?)$/);
              if (match) {
                data.ville = match[1].trim();
              }
              break;
            }
          }
        } catch (e) {}

        // TÉLÉPHONE
        try {
          const telLinks = await item.findElements(By.css('a[href^="tel:"]'));
          if (telLinks.length > 0) {
            data.telephone = (await telLinks[0].getText()).trim().replace(/\s/g, '');
          }
        } catch (e) {}

        // STATUT
        try {
          const badges = await item.findElements(By.css('.opening-time-badge-wrapper, [class*="badge"]'));
          if (badges.length > 0) {
            const badgeText = (await badges[0].getText()).trim();
            if (badgeText) {
              data.statut = badgeText;
            }
          }
        } catch (e) {}

        if (data.nom && data.nom.length > 3) {
          results.push(data);
        }

      } catch (e) {
        // Ignorer
      }
    }

  } catch (e) {
    console.error('      ❌ Erreur scraping:', (e as Error).message);
  }

  return results;
}

export async function scrapeMaSecurite(
  searchTerm: string,
  location = ''
): Promise<MaSecuriteRow[]> {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   🔍 MASÉCURITÉ.GOUV.FR               ║`);
  console.log(`╚════════════════════════════════════════╝`);
  console.log(`   Recherche: "${searchTerm}"`);
  console.log(`   Localisation: "${location || 'France'}"\n`);

  let driver: WebDriver | null = null;
  const allResults: MaSecuriteRow[] = [];

  try {
    driver = await createDriver();

    console.log('   🔍 Accès au site...');
    await driver.get(BASE);
    await driver.sleep(3000);

    // Trouver le champ de recherche
    let searchInput;
    try {
      searchInput = await driver.findElement(
        By.css('input[type="search"], input[type="text"], input[placeholder*="adresse"]')
      );
    } catch (e) {
      console.log('   ❌ Champ de recherche introuvable');
      return [];
    }

    // Taper la recherche
    const query = location || searchTerm;
    console.log(`   ⌨️  Saisie: "${query}"`);
    await searchInput.clear();
    await searchInput.sendKeys(query);
    await driver.sleep(3000);

    // Attendre les suggestions
    console.log('   ⏳ Attente des suggestions...');
    let suggestions;
    try {
      await driver.wait(
        until.elementsLocated(By.css('li[data-autocomplete-value], li.list-group-item, li[role="option"]')),
        10000
      );
      
      suggestions = await driver.findElements(
        By.css('li[data-autocomplete-value], li.list-group-item, li[role="option"]')
      );
    } catch (e) {
      console.log('   ⚠️ Aucune suggestion trouvée');
      return [];
    }

    console.log(`   → ${suggestions.length} suggestion(s) trouvée(s)\n`);

    if (suggestions.length === 0) {
      return [];
    }

    // Traiter chaque suggestion
    for (let i = 0; i < Math.min(suggestions.length, 5); i++) {
      try {
        // Retaper la recherche (car après chaque clic, on perd les suggestions)
        if (i > 0) {
          await driver.get(BASE);
          await driver.sleep(2000);
          
          const newInput = await driver.findElement(
            By.css('input[type="search"], input[type="text"]')
          );
          await newInput.clear();
          await newInput.sendKeys(query);
          await driver.sleep(2000);
          
          await driver.wait(
            until.elementsLocated(By.css('li[data-autocomplete-value], li.list-group-item')),
            5000
          );
        }

        // Re-récupérer les suggestions
        const currentSuggestions = await driver.findElements(
          By.css('li[data-autocomplete-value], li.list-group-item, li[role="option"]')
        );

        if (i >= currentSuggestions.length) {
          break;
        }

        const suggestion = currentSuggestions[i];
        
        // Récupérer le texte de la suggestion
        const suggestionText = (await suggestion.getText()).trim().substring(0, 50);
        console.log(`   [${i + 1}/${Math.min(suggestions.length, 5)}] ${suggestionText}...`);

        // Cliquer sur la suggestion
        await driver.executeScript('arguments[0].scrollIntoView(true);', suggestion);
        await driver.sleep(500);
        await driver.executeScript('arguments[0].click();', suggestion);
        await driver.sleep(3000);

        // Scraper les résultats
        const pageResults = await scrapeResults(driver);
        console.log(`      ✅ ${pageResults.length} trouvé(s)`);

        // Ajouter sans doublons
        for (const result of pageResults) {
          const isDuplicate = allResults.some(
            r => r.nom === result.nom && r.adresse === result.adresse
          );
          if (!isDuplicate) {
            allResults.push(result);
          }
        }

      } catch (e) {
        console.error(`      ❌ Erreur suggestion ${i + 1}:`, (e as Error).message);
      }
    }

    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║   ✅ MASÉCURITÉ TERMINÉ               ║`);
    console.log(`╚════════════════════════════════════════╝`);
    console.log(`   Total: ${allResults.length} établissements\n`);

    return allResults;

  } catch (error) {
    console.error('❌ Erreur MaSécurité:', (error as Error).message);
    return [];
  } finally {
    if (driver) {
      await driver.quit();
    }
  }
}