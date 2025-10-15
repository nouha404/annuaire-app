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

/**
 * Extrait les résultats de la liste affichée
 */
async function extractResults(driver: WebDriver): Promise<MaSecuriteRow[]> {
  const results: MaSecuriteRow[] = [];

  try {
    const currentUrl = await driver.getCurrentUrl();
    console.log(`      📍 URL actuelle: ${currentUrl.substring(0, 80)}...`);

    console.log('      ⏳ Attente de la liste de résultats...');
    await driver.wait(
      until.elementLocated(By.css('ul#results-point-list')),
      10000
    );

    await driver.sleep(2000);

    const noResults = await driver.findElements(By.css('#no-results-point-list:not(.fr-hidden)'));
    if (noResults.length > 0) {
      console.log('      ℹ️  Message "Aucun résultat" affiché');
      return [];
    }

    const items = await driver.findElements(By.css('ul#results-point-list li.force-point-list-item'));
    
    if (items.length === 0) {
      console.log('      ⚠️  Liste trouvée mais aucun item dedans');
      const listHtml = await driver.executeScript(`
        const list = document.querySelector('ul#results-point-list');
        return list ? list.innerHTML.substring(0, 300) : 'Liste introuvable';
      `);
      console.log('      🔍 HTML:', listHtml);
      return [];
    }
    
    console.log(`      → ${items.length} établissement(s) dans la liste`);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const data: MaSecuriteRow = {
          nom: '',
          adresse: '',
          telephone: '',
          statut: '',
          type: '',
          ville: ''
        };

        try {
          const nomElement = await item.findElement(By.css('h2.point-label'));
          data.nom = (await nomElement.getText()).trim();
          
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
        } catch (e) {
          console.log(`      ⚠️  Item ${i+1}: Impossible de lire le nom`);
        }

        try {
          const addrElement = await item.findElement(By.css('a.point-address'));
          const fullAddress = (await addrElement.getText()).trim();
          data.adresse = fullAddress;
          
          const match = fullAddress.match(/(\d{5})\s+(.+?)$/);
          if (match) {
            data.ville = match[2].trim();
          }
        } catch (e) {}

        try {
          const phoneElement = await item.findElement(By.css('.point-phone a'));
          data.telephone = (await phoneElement.getText()).trim().replace(/\s/g, '');
        } catch (e) {}

        try {
          const statutElement = await item.findElement(By.css('.opening-time-badge'));
          data.statut = (await statutElement.getText()).trim();
        } catch (e) {}

        if (data.nom && data.nom.length > 3) {
          results.push(data);
          console.log(`      ✅ [${i+1}/${items.length}] ${data.nom.substring(0, 50)}`);
        } else {
          console.log(`      ⚠️  [${i+1}/${items.length}] Item ignoré (nom invalide)`);
        }

      } catch (e) {
        console.log(`      ❌ [${i+1}/${items.length}] Erreur:`, (e as Error).message);
      }
    }

  } catch (e) {
    console.error('      ❌ Erreur extraction:', (e as Error).message);
    
    try {
      const screenshot = await driver.takeScreenshot();
      console.log('      📸 Screenshot capturé (base64, premiers 100 chars):', screenshot.substring(0, 100));
    } catch (screenshotError) {}
  }

  console.log(`      📊 Total extrait: ${results.length} établissements valides`);
  return results;
}

/**
 * Fonction interne qui effectue le scraping avec un driver garanti existant
 */
async function scrapeWithDriver(
  driver: WebDriver,
  searchTerm: string,
  location: string
): Promise<MaSecuriteRow[]> {
  const allResults: MaSecuriteRow[] = [];

  console.log('   🌐 Accès au site...');
  await driver.get(BASE);
  await driver.sleep(4000);

  // ===== FERMETURE COMPLÈTE DU MODAL DE COOKIES =====
  console.log('   🍪 Gestion des cookies...');
  try {
    const acceptAllBtn = await driver.findElements(
      By.css('#tarteaucitronPersonalize2, #tarteaucitronAllAllowed, #tarteaucitronAllDenied2')
    );
    if (acceptAllBtn.length > 0) {
      for (const btn of acceptAllBtn) {
        try {
          if (await btn.isDisplayed()) {
            console.log('      → Clic sur bouton cookies');
            await driver.executeScript('arguments[0].click();', btn);
            await driver.sleep(1500);
            break;
          }
        } catch (e) {}
      }
    }

    const closeAlert = await driver.findElements(
      By.css('#tarteaucitronCloseAlert, button[aria-controls="tarteaucitronAlertBig"]')
    );
    if (closeAlert.length > 0) {
      for (const btn of closeAlert) {
        try {
          if (await btn.isDisplayed()) {
            console.log('      → Fermeture de la bannière');
            await driver.executeScript('arguments[0].click();', btn);
            await driver.sleep(1000);
            break;
          }
        } catch (e) {}
      }
    }

    await driver.executeScript(`
      const selectorsToRemove = [
        '#tarteaucitronRoot',
        '#tarteaucitronAlertBig',
        '#tarteaucitronBack',
        '.tarteaucitronAlertBigBottom',
        '#tarteaucitron',
        '[id*="tarteaucitron"]'
      ];
      
      selectorsToRemove.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (el && el.parentNode) {
            el.parentNode.removeChild(el);
          }
        });
      });
      
      document.body.style.overflow = 'auto';
      document.body.style.position = 'static';
      
      console.log('Overlays cookies supprimés');
    `);
    
    console.log('   ✅ Cookies gérés (overlays supprimés)');
    await driver.sleep(1000);
    
  } catch (e) {
    console.log('   ⚠️  Problème cookies:', (e as Error).message);
  }

  // Trouver le champ de recherche
  let searchInput;
  try {
    await driver.wait(until.elementLocated(By.css('input#inputCiat')), 10000);
    searchInput = await driver.findElement(By.css('input#inputCiat'));
    
    const isDisplayed = await searchInput.isDisplayed();
    const isEnabled = await searchInput.isEnabled();
    console.log(`   ✅ Champ trouvé (visible: ${isDisplayed}, enabled: ${isEnabled})`);
    
    if (!isDisplayed || !isEnabled) {
      throw new Error('Champ de recherche non interactif');
    }
  } catch (e) {
    console.log('   ❌ Champ de recherche introuvable ou non interactif');
    console.log('   💡 Le site a peut-être changé de structure');
    return [];
  }

  // Déterminer la requête
  let query = location || searchTerm;
  
  const isOrgType = /commissariat|gendarmerie|police|mairie|préfecture/i.test(searchTerm);
  if (isOrgType && !location) {
    console.log('   ⚠️ MaSécurité nécessite une localisation (ville/code postal)');
    console.log('   💡 Ajoutez un paramètre "where" pour obtenir des résultats\n');
    return [];
  }
  
  console.log(`   ⌨️  Saisie: "${query}"`);
  
  // Scroller vers le champ et l'activer via JavaScript
  try {
    await driver.executeScript(`
      const input = arguments[0];
      input.scrollIntoView({block: 'center', behavior: 'smooth'});
    `, searchInput);
    await driver.sleep(500);
    
    await driver.executeScript(`
      const input = arguments[0];
      input.focus();
      input.click();
    `, searchInput);
    await driver.sleep(500);
    
    console.log('   ✅ Champ activé');
  } catch (e) {
    console.log('   ⚠️  Erreur activation:', (e as Error).message);
  }
  
  // Vider et taper caractère par caractère
  await searchInput.clear();
  await driver.sleep(300);
  
  for (const char of query) {
    await searchInput.sendKeys(char);
    await driver.sleep(150);
  }
  
  console.log('   ⏳ Attente des suggestions (15s max)...');
  
  // Attendre que la liste devienne visible
  let suggestions;
  try {
    await driver.wait(async () => {
      const list = await driver.findElements(By.css('ul#map-point-autocomplete-list:not([hidden])'));
      return list.length > 0;
    }, 15000);
    
    await driver.sleep(1500);
    
    suggestions = await driver.findElements(
      By.css('ul#map-point-autocomplete-list li.list-group-item[role="option"]')
    );
    
    console.log(`   📋 ${suggestions.length} suggestion(s) trouvée(s)`);
    
    if (suggestions.length === 0) {
      const listHtml = await driver.executeScript(`
        const list = document.querySelector('ul#map-point-autocomplete-list');
        return list ? list.outerHTML.substring(0, 500) : 'Liste introuvable';
      `);
      console.log('   🔍 HTML de la liste:', listHtml);
    }
    
  } catch (e) {
    console.log('   ⚠️ Timeout : aucune suggestion trouvée');
    console.log('   💡 La ville/code postal n\'existe peut-être pas');
    
    const pageSource = await driver.getPageSource();
    if (pageSource.includes('Aucun résultat') || pageSource.includes('aucune suggestion')) {
      console.log('   💡 Confirmation : pas de résultats pour cette recherche\n');
    }
    return [];
  }

  if (!suggestions || suggestions.length === 0) {
    console.log('   ⚠️ Aucune suggestion disponible\n');
    return [];
  }

  // Cliquer sur la PREMIÈRE suggestion
  try {
    const firstSuggestion = suggestions[0];
    const suggestionText = (await firstSuggestion.getText()).trim();
    console.log(`   [1/1] Sélection : ${suggestionText.substring(0, 60)}...`);

    await driver.executeScript(`
      const suggestion = arguments[0];
      suggestion.scrollIntoView({block: 'center'});
    `, firstSuggestion);
    await driver.sleep(500);
    
    await driver.executeScript('arguments[0].click();', firstSuggestion);
    
    console.log('   ⏳ Chargement des résultats...');
    await driver.sleep(5000);

    const pageResults = await extractResults(driver);
    console.log(`   ✅ ${pageResults.length} établissement(s) récupéré(s)`);

    allResults.push(...pageResults);

  } catch (e) {
    console.error(`   ❌ Erreur lors de la sélection:`, (e as Error).message);
  }

  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   ✅ SCRAPING TERMINÉ                 ║`);
  console.log(`╚════════════════════════════════════════╝`);
  console.log(`   Total: ${allResults.length} établissements\n`);

  return allResults;
}

/**
 * Fonction principale exportée
 */
export async function scrapeMaSecurite(
  searchTerm: string,
  location = ''
): Promise<MaSecuriteRow[]> {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   🔍 MASÉCURITÉ.GOUV.FR               ║`);
  console.log(`╚════════════════════════════════════════╝`);
  console.log(`   Recherche: "${searchTerm}"`);
  console.log(`   Localisation: "${location || 'France'}"\n`);

  let driver: WebDriver | undefined;

  try {
    driver = await createDriver();
    
    // ✅ Driver garanti existant, TypeScript est content
    return await scrapeWithDriver(driver, searchTerm, location);

  } catch (error) {
    console.error('❌ Erreur globale MaSécurité:', (error as Error).message);
    return [];
  } finally {
    if (driver) {
      try {
        await driver.quit();
        console.log('   ✅ Driver fermé proprement');
      } catch (quitError) {
        console.error('   ⚠️  Erreur fermeture driver:', (quitError as Error).message);
      }
    }
  }
}