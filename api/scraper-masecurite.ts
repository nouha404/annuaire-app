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
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '--disable-images', // ⚡ Pas d'images
    '--disable-css' // ⚡ Pas de CSS
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

async function extractResults(driver: WebDriver): Promise<MaSecuriteRow[]> {
  const results: MaSecuriteRow[] = [];

  try {
    const currentUrl = await driver.getCurrentUrl();
    console.log(`      📍 URL actuelle: ${currentUrl.substring(0, 80)}...`);

    console.log('      ⏳ Attente de la liste de résultats...');
    await driver.wait(
      until.elementLocated(By.css('ul#results-point-list')),
      5000 // ⚡ Réduit de 10000 à 5000
    );

    await driver.sleep(800); // ⚡ Réduit de 2000 à 800

    const noResults = await driver.findElements(By.css('#no-results-point-list:not(.fr-hidden)'));
    if (noResults.length > 0) {
      console.log('      ℹ️  Message "Aucun résultat" affiché');
      return [];
    }

    const items = await driver.findElements(By.css('ul#results-point-list li.force-point-list-item'));
    
    if (items.length === 0) {
      console.log('      ⚠️  Liste trouvée mais aucun item dedans');
      return [];
    }
    
    console.log(`      → ${items.length} établissement(s) dans la liste`);

    // ⚡ EXTRACTION PARALLÈLE
    const itemsData = await Promise.all(
      items.map(async (item, i) => {
        try {
          const data: MaSecuriteRow = {
            nom: '',
            adresse: '',
            telephone: '',
            statut: '',
            type: '',
            ville: ''
          };

          // Extraction parallèle de tous les champs
          const [nomText, addrText, phoneText, statutText] = await Promise.all([
            item.findElement(By.css('h2.point-label')).then(el => el.getText()).catch(() => ''),
            item.findElement(By.css('a.point-address')).then(el => el.getText()).catch(() => ''),
            item.findElement(By.css('.point-phone a')).then(el => el.getText()).catch(() => ''),
            item.findElement(By.css('.opening-time-badge')).then(el => el.getText()).catch(() => '')
          ]);

          data.nom = nomText.trim();
          data.adresse = addrText.trim();
          data.telephone = phoneText.trim().replace(/\s/g, '');
          data.statut = statutText.trim();

          // Type
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

          // Ville
          const match = data.adresse.match(/(\d{5})\s+(.+?)$/);
          if (match) {
            data.ville = match[2].trim();
          }

          if (data.nom && data.nom.length > 3) {
            console.log(`      ✅ [${i+1}/${items.length}] ${data.nom.substring(0, 50)}`);
            return data;
          } else {
            console.log(`      ⚠️  [${i+1}/${items.length}] Item ignoré (nom invalide)`);
            return null;
          }

        } catch (e) {
          console.log(`      ❌ [${i+1}/${items.length}] Erreur:`, (e as Error).message);
          return null;
        }
      })
    );

    // Filtrer les null
    itemsData.forEach(data => {
      if (data) results.push(data);
    });

  } catch (e) {
    console.error('      ❌ Erreur extraction:', (e as Error).message);
  }

  console.log(`      📊 Total extrait: ${results.length} établissements valides`);
  return results;
}

async function scrapeWithDriver(
  driver: WebDriver,
  searchTerm: string,
  location: string
): Promise<MaSecuriteRow[]> {
  const allResults: MaSecuriteRow[] = [];

  console.log('   🌐 Accès au site...');
  await driver.get(BASE);
  await driver.sleep(1500); // ⚡ Réduit de 4000 à 1500

  // Gestion cookies - RAPIDE
  console.log('   🍪 Gestion des cookies...');
  try {
    // ⚡ Suppression directe par JS sans attendre les boutons
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
    `);
    
    console.log('   ✅ Cookies gérés');
    await driver.sleep(300); // ⚡ Réduit de 1000 à 300
    
  } catch (e) {
    console.log('   ⚠️  Problème cookies:', (e as Error).message);
  }

  // Trouver le champ de recherche
  let searchInput;
  try {
    await driver.wait(until.elementLocated(By.css('input#inputCiat')), 5000); // ⚡ Réduit de 10000 à 5000
    searchInput = await driver.findElement(By.css('input#inputCiat'));
    
    const isDisplayed = await searchInput.isDisplayed();
    const isEnabled = await searchInput.isEnabled();
    console.log(`   ✅ Champ trouvé (visible: ${isDisplayed}, enabled: ${isEnabled})`);
    
    if (!isDisplayed || !isEnabled) {
      throw new Error('Champ de recherche non interactif');
    }
  } catch (e) {
    console.log('   ❌ Champ de recherche introuvable ou non interactif');
    return [];
  }

  // Déterminer la requête
  let query = location || searchTerm;
  
  const isOrgType = /commissariat|gendarmerie|police|mairie|préfecture/i.test(searchTerm);
  if (isOrgType && !location) {
    console.log('   ⚠️ MaSécurité nécessite une localisation (ville/code postal)');
    return [];
  }
  
  console.log(`   ⌨️  Saisie: "${query}"`);
  
  // Scroller et activer
  try {
    await driver.executeScript(`
      const input = arguments[0];
      input.scrollIntoView({block: 'center', behavior: 'auto'});
      input.focus();
      input.click();
    `, searchInput);
    await driver.sleep(200); // ⚡ Réduit de 500 à 200
    
    console.log('   ✅ Champ activé');
  } catch (e) {
    console.log('   ⚠️  Erreur activation:', (e as Error).message);
  }
  
  // Vider et taper
  await searchInput.clear();
  await driver.sleep(100); // ⚡ Réduit de 300 à 100
  
  // ⚡ Taper plus vite
  for (const char of query) {
    await searchInput.sendKeys(char);
    await driver.sleep(50); // ⚡ Réduit de 150 à 50
  }
  
  console.log('   ⏳ Attente des suggestions...');
  
  // Attendre les suggestions
  let suggestions;
  try {
    await driver.wait(async () => {
      const list = await driver.findElements(By.css('ul#map-point-autocomplete-list:not([hidden])'));
      return list.length > 0;
    }, 8000); // ⚡ Réduit de 15000 à 8000
    
    await driver.sleep(500); // ⚡ Réduit de 1500 à 500
    
    suggestions = await driver.findElements(
      By.css('ul#map-point-autocomplete-list li.list-group-item[role="option"]')
    );
    
    console.log(`   📋 ${suggestions.length} suggestion(s) trouvée(s)`);
    
  } catch (e) {
    console.log('   ⚠️ Timeout : aucune suggestion trouvée');
    return [];
  }

  if (!suggestions || suggestions.length === 0) {
    console.log('   ⚠️ Aucune suggestion disponible\n');
    return [];
  }

  // Cliquer sur la première suggestion
  try {
    const firstSuggestion = suggestions[0];
    const suggestionText = (await firstSuggestion.getText()).trim();
    console.log(`   [1/1] Sélection : ${suggestionText.substring(0, 60)}...`);

    await driver.executeScript(`
      const suggestion = arguments[0];
      suggestion.scrollIntoView({block: 'center'});
    `, firstSuggestion);
    await driver.sleep(200); // ⚡ Réduit de 500 à 200
    
    await driver.executeScript('arguments[0].click();', firstSuggestion);
    
    console.log('   ⏳ Chargement des résultats...');
    await driver.sleep(2000); // ⚡ Réduit de 5000 à 2000

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