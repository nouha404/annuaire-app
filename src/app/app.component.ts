import { Component } from '@angular/core';
import { AnnuaireService, Row } from './annuaire.service';

type TabId = 'service-public' | 'masecurite';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  title = 'annuaire-app';
  what = '';
  where = '';
  maxPages = 3;
  
  // Système d'onglets
  activeTab: TabId = 'service-public';
  
  // Résultats par source
  rowsServicePublic: Row[] = [];
  rowsMaSecurite: Row[] = [];
  
  // États de chargement par source
  loadingServicePublic = false;
  loadingMaSecurite = false;
  
  // Erreurs par source
  errorServicePublic = '';
  errorMaSecurite = '';
  
  // Progression
  loadingStep = '';
  progress = 0;

  constructor(private api: AnnuaireService) {}

  // Getter pour les résultats de l'onglet actif
  get currentRows(): Row[] {
    return this.activeTab === 'service-public' 
      ? this.rowsServicePublic 
      : this.rowsMaSecurite;
  }

  get isLoading(): boolean {
    return this.loadingServicePublic || this.loadingMaSecurite;
  }

  get currentError(): string {
    return this.activeTab === 'service-public' 
      ? this.errorServicePublic 
      : this.errorMaSecurite;
  }

  // Changer d'onglet
  switchTab(tab: TabId) {
    this.activeTab = tab;
  }

  async onSearch() {
    if (!this.what.trim()) {
      this.errorServicePublic = 'Veuillez entrer un terme de recherche';
      return;
    }

    // Reset
    this.errorServicePublic = '';
    this.errorMaSecurite = '';
    this.rowsServicePublic = [];
    this.rowsMaSecurite = [];
    this.loadingServicePublic = true;
    this.progress = 0;

    try {
      this.loadingStep = '📡 Connexion à Service-Public.fr...';
      this.progress = 10;
      await this.wait(500);

      this.loadingStep = '🔍 Recherche des résultats...';
      this.progress = 20;
      await this.wait(500);

      this.loadingStep = '🔗 Collecte des liens...';
      this.progress = 40;

      const resp = await this.api.search(
        this.what.trim(),
        this.where.trim(),
        Number(this.maxPages)
      );

      this.loadingStep = '📥 Extraction des données...';
      this.progress = 70;
      await this.wait(300);

      this.loadingStep = '✨ Finalisation...';
      this.progress = 90;

      // Séparer les résultats par source
      this.rowsServicePublic = resp.rows.filter(r => r.source === 'Service-Public');
      this.rowsMaSecurite = resp.rows.filter(r => r.source !== 'Service-Public');

      this.progress = 100;
      this.loadingStep = `✅ ${resp.rows.length} résultats trouvés !`;

      console.log(`✅ Service-Public: ${this.rowsServicePublic.length}`);
      console.log(`✅ MaSécurité: ${this.rowsMaSecurite.length}`);

      await this.wait(500);

    } catch (e: any) {
      this.errorServicePublic = e?.error?.error || e?.message || 'Erreur de recherche';
      console.error('❌ Erreur:', e);
    } finally {
      this.loadingServicePublic = false;
      this.loadingStep = '';
    }
  }

  async onExportCsv() {
    const rows = this.currentRows;
    if (rows.length === 0) {
      alert('Aucun résultat à exporter');
      return;
    }

    try {
      // Générer le CSV côté client à partir des données déjà récupérées
      const cols = ['source', 'nom', 'adresse', 'telephone', 'ville', 'type', 'region', 'statut'];
      const escapeCSV = (val: any) => {
        const str = String(val ?? '').replace(/\r?\n/g, ' ').trim();
        if (str.includes(',') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      
      const header = cols.join(',');
      const body = rows.map(r => cols.map(c => escapeCSV((r as any)[c])).join(',')).join('\n');
      const csv = '\ufeff' + header + '\n' + body;
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = this.activeTab === 'service-public' 
        ? `service-public_${this.what.replace(/\s+/g, '_')}.csv`
        : `masecurite_${this.what.replace(/\s+/g, '_')}.csv`;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      
      console.log(`✅ CSV exporté: ${rows.length} lignes`);
    } catch (e) {
      alert('Export CSV échoué.');
      console.error(e);
    }
  }

  async onExportXlsx() {
    const rows = this.currentRows;
    if (rows.length === 0) {
      alert('Aucun résultat à exporter');
      return;
    }

    try {
      this.loadingServicePublic = true;
      this.loadingStep = '📊 Génération du fichier Excel...';
      
      const blob = await this.api.downloadXlsx(
        this.what.trim(),
        this.where.trim(),
        Number(this.maxPages)
      );
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = this.activeTab === 'service-public' 
        ? `service-public_${this.what.replace(/\s+/g, '_')}.xlsx`
        : `masecurite_${this.what.replace(/\s+/g, '_')}.xlsx`;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export XLSX échoué.');
      console.error(e);
    } finally {
      this.loadingServicePublic = false;
      this.loadingStep = '';
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}