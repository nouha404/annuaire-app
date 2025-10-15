import { Component, OnInit, OnDestroy } from '@angular/core';
import { AnnuaireService, Row } from './annuaire.service';
import { Subscription } from 'rxjs';

type TabId = 'service-public' | 'masecurite';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'annuaire-app';
  what = '';
  where = '';
  maxPages = 3;
  
  // Système d'onglets
  activeTab: TabId = 'service-public';
  
  // Résultats par source
  rowsServicePublic: Row[] = [];
  rowsMaSecurite: Row[] = [];
  
  // États de chargement
  loadingServicePublic = false;
  loadingMaSecurite = false;
  
  // Erreurs
  errorServicePublic = '';
  errorMaSecurite = '';
  
  // Progression
  loadingStep = '';
  progress = 0;
  
  // 🔥 LOGS EN TEMPS RÉEL
  logs: string[] = [];
  showLogs = true; // Afficher la zone de logs par défaut
  private logSubscription?: Subscription;

  constructor(private api: AnnuaireService) {}

  ngOnInit() {
    // S'abonner aux logs
    this.logSubscription = this.api.logs$.subscribe((log: string) => {
      this.logs.push(log);
      
      // Auto-scroll vers le bas
      setTimeout(() => {
        const logsContainer = document.getElementById('logs-container');
        if (logsContainer) {
          logsContainer.scrollTop = logsContainer.scrollHeight;
        }
      }, 100);
      
      // Limiter à 200 lignes pour éviter la surcharge
      if (this.logs.length > 200) {
        this.logs = this.logs.slice(-200);
      }
    });
  }

  ngOnDestroy() {
    if (this.logSubscription) {
      this.logSubscription.unsubscribe();
    }
    this.api.stopListeningLogs();
  }

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

  // Toggle logs
  toggleLogs() {
    this.showLogs = !this.showLogs;
  }

  // Clear logs
  clearLogs() {
    this.logs = [];
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
    this.logs = [];
    this.loadingServicePublic = true;
    this.progress = 0;
    this.showLogs = true; // Afficher les logs pendant la recherche

    try {
      this.loadingStep = '📡 Initialisation du scraping...';
      this.progress = 5;

      const resp = await this.api.search(
        this.what.trim(),
        this.where.trim(),
        Number(this.maxPages)
      );

      // Séparer les résultats par source
      this.rowsServicePublic = resp.rows.filter(r => r.source === 'Service-Public');
      this.rowsMaSecurite = resp.rows.filter(r => r.source !== 'Service-Public');

      this.progress = 100;
      this.loadingStep = `✅ ${resp.rows.length} résultats trouvés !`;

      console.log(`✅ Service-Public: ${this.rowsServicePublic.length}`);
      console.log(`✅ MaSécurité: ${this.rowsMaSecurite.length}`);

      await this.wait(1000);

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