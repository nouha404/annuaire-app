

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
    // D'abord vérifier si on est bien sur une page avec des résultats
    const currentUrl = await driver.getCurrentUrl();
    console.log(`      📍 URL actuelle: ${currentUrl.substring(0, 80)}...`);

    // Attendre que les résultats se chargent
    console.log('      ⏳ Attente de la liste de résultats...');
    await driver.wait(
      until.elementLocated(By.css('ul#results-point-list')),
      10000
    );

    await driver.sleep(2000);

    // Vérifier si on a le message "aucun résultat"
    const noResults = await driver.findElements(By.css('#no-results-point-list:not(.fr-hidden)'));
    if (noResults.length > 0) {
      console.log('      ℹ️  Message "Aucun résultat" affiché');
      return [];
    }

    // Récupérer tous les items de la liste
    const items = await driver.findElements(By.css('ul#results-point-list li.force-point-list-item'));
    
    if (items.length === 0) {
      console.log('      ⚠️  Liste trouvée mais aucun item dedans');
      // Debug : récupérer le HTML de la liste
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

        // NOM
        try {
          const nomElement = await item.findElement(By.css('h2.point-label'));
          data.nom = (await nomElement.getText()).trim();
          
          // Détecter le type depuis le nom
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

        // ADRESSE
        try {
          const addrElement = await item.findElement(By.css('a.point-address'));
          const fullAddress = (await addrElement.getText()).trim();
          data.adresse = fullAddress;
          
          // Extraire la ville (après le code postal)
          const match = fullAddress.match(/(\d{5})\s+(.+?)$/);
          if (match) {
            data.ville = match[2].trim();
          }
        } catch (e) {}

        // TÉLÉPHONE
        try {
          const phoneElement = await item.findElement(By.css('.point-phone a'));
          data.telephone = (await phoneElement.getText()).trim().replace(/\s/g, '');
        } catch (e) {}

        // STATUT (Ouvert/Fermé)
        try {
          const statutElement = await item.findElement(By.css('.opening-time-badge'));
          data.statut = (await statutElement.getText()).trim();
        } catch (e) {}

        // Ajouter si on a au moins le nom
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
    
    // Essayer de capturer une capture d'écran pour debug
    try {
      const screenshot = await driver.takeScreenshot();
      console.log('      📸 Screenshot capturé (base64, premiers 100 chars):', screenshot.substring(0, 100));
    } catch (screenshotError) {}
  }

  console.log(`      📊 Total extrait: ${results.length} établissements valides`);
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

    console.log('   🌐 Accès au site...');
    await driver.get(BASE);
    await driver.sleep(4000);

    // ===== FERMETURE COMPLÈTE DU MODAL DE COOKIES =====
    console.log('   🍪 Gestion des cookies...');
    try {
      // Stratégie 1 : Accepter/refuser tous les cookies via les boutons
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

      // Stratégie 2 : Fermer l'alerte/bannière
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

      // Stratégie 3 : SUPPRESSION RADICALE de tous les overlays
      await driver.executeScript(`
        // Supprimer tous les éléments qui peuvent bloquer
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
        
        // Remettre le body en état normal
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
      // Attendre que le champ soit interactif
      await driver.wait(until.elementLocated(By.css('input#inputCiat')), 10000);
      searchInput = await driver.findElement(By.css('input#inputCiat'));
      
      // S'assurer qu'il est visible
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
    
    // Scroller vers le champ et l'activer via JavaScript (évite les interceptions)
    try {
      await driver.executeScript(`
        const input = arguments[0];
        input.scrollIntoView({block: 'center', behavior: 'smooth'});
      `, searchInput);
      await driver.sleep(500);
      
      // Focus et clic via JavaScript (plus fiable que click() natif)
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
    
    // Vider et taper caractère par caractère (plus naturel pour déclencher l'autocomplete)
    await searchInput.clear();
    await driver.sleep(300);
    
    for (const char of query) {
      await searchInput.sendKeys(char);
      await driver.sleep(150); // Délai entre chaque caractère
    }
    
    console.log('   ⏳ Attente des suggestions (15s max)...');
    
    // Attendre que la liste devienne visible
    let suggestions;
    try {
      // D'abord attendre que l'attribut hidden soit retiré
      await driver.wait(async () => {
        const list = await driver.findElements(By.css('ul#map-point-autocomplete-list:not([hidden])'));
        return list.length > 0;
      }, 15000);
      
      await driver.sleep(1500);
      
      // Ensuite récupérer les suggestions
      suggestions = await driver.findElements(
        By.css('ul#map-point-autocomplete-list li.list-group-item[role="option"]')
      );
      
      console.log(`   📋 ${suggestions.length} suggestion(s) trouvée(s)`);
      
      // Debug : afficher le HTML de la liste si vide
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
      
      // Essayer de voir ce qu'il y a dans la page
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

      // Rendre visible et cliquer via JavaScript
      await driver.executeScript(`
        const suggestion = arguments[0];
        suggestion.scrollIntoView({block: 'center'});
      `, firstSuggestion);
      await driver.sleep(500);
      
      // Clic JavaScript (plus fiable)
      await driver.executeScript('arguments[0].click();', firstSuggestion);
      
      console.log('   ⏳ Chargement des résultats...');
      await driver.sleep(5000);

      // Extraire les résultats
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

  } catch (error) {
    console.error('❌ Erreur globale MaSécurité:', (error as Error).message);
    return [];
  } finally {
    if (driver) {
      await driver.quit();
    }
  }
}