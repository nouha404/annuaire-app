import { Component, OnInit, OnDestroy } from '@angular/core';
import { AnnuaireService, Row } from './annuaire.service';
import { Subscription } from 'rxjs';

type TabId = 'service-public' | 'masecurite';

interface SearchHistoryEntry {
  what: string;
  where: string;
  date: string;
  resultCount: number;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'annuaire-app';
  what = '';
  where = '';
  maxPages = 999;
  
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
  
  // ⏱️ Chronomètre
  elapsedTime = 0;
  totalDuration = 0;
  private timerInterval?: any;
  
  // 🔥 LOGS EN TEMPS RÉEL
  logs: string[] = [];
  showLogs = true;
  private logSubscription?: Subscription;

  // 📜 HISTORIQUE DES RECHERCHES
  searchHistory: SearchHistoryEntry[] = [];
  showHistory = false;

  constructor(private api: AnnuaireService) {}

  ngOnInit() {
    this.logSubscription = this.api.logs$.subscribe((log: string) => {
      this.logs.push(log);
      
      setTimeout(() => {
        const logsContainer = document.getElementById('logs-container');
        if (logsContainer) {
          logsContainer.scrollTop = logsContainer.scrollHeight;
        }
      }, 100);
      
      if (this.logs.length > 200) {
        this.logs = this.logs.slice(-200);
      }
    });

    this.loadSearchHistory();
  }

  ngOnDestroy() {
    if (this.logSubscription) {
      this.logSubscription.unsubscribe();
    }
    this.api.stopListeningLogs();
    this.stopTimer();
  }

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

  // ⏱️ Gestion du chronomètre
  private startTimer() {
    this.elapsedTime = 0;
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.elapsedTime++;
    }, 1000);
  }

  private stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
      this.totalDuration = this.elapsedTime;
    }
  }

  // 📜 Gestion de l'historique
  private loadSearchHistory() {
    try {
      const saved = localStorage.getItem('search-history');
      if (saved) {
        this.searchHistory = JSON.parse(saved);
      }
    } catch (e) {
      console.error('Erreur chargement historique:', e);
    }
  }

  private saveToHistory(what: string, where: string, resultCount: number) {
    const entry: SearchHistoryEntry = {
      what,
      where,
      date: new Date().toISOString(),
      resultCount
    };

    this.searchHistory = this.searchHistory.filter(
      h => !(h.what === what && h.where === where)
    );

    this.searchHistory.unshift(entry);

    if (this.searchHistory.length > 10) {
      this.searchHistory = this.searchHistory.slice(0, 10);
    }

    try {
      localStorage.setItem('search-history', JSON.stringify(this.searchHistory));
    } catch (e) {
      console.error('Erreur sauvegarde historique:', e);
    }
  }

  clearHistory() {
    if (confirm('Voulez-vous vraiment effacer tout l\'historique ?')) {
      this.searchHistory = [];
      localStorage.removeItem('search-history');
    }
  }

  toggleHistory() {
    this.showHistory = !this.showHistory;
  }

  loadFromHistory(entry: SearchHistoryEntry) {
    this.what = entry.what;
    this.where = entry.where;
    this.showHistory = false;
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'À l\'instant';
    if (minutes < 60) return `Il y a ${minutes} min`;
    if (hours < 24) return `Il y a ${hours}h`;
    if (days < 7) return `Il y a ${days}j`;
    
    return date.toLocaleDateString('fr-FR', { 
      day: 'numeric', 
      month: 'short' 
    });
  }

  switchTab(tab: TabId) {
    this.activeTab = tab;
  }

  toggleLogs() {
    this.showLogs = !this.showLogs;
  }

  clearLogs() {
    this.logs = [];
  }

  async onSearch() {
    if (!this.what.trim()) {
      this.errorServicePublic = 'Veuillez entrer un terme de recherche';
      return;
    }

    this.errorServicePublic = '';
    this.errorMaSecurite = '';
    this.rowsServicePublic = [];
    this.rowsMaSecurite = [];
    this.logs = [];
    this.loadingServicePublic = true;
    this.progress = 0;
    this.showLogs = true;
    this.totalDuration = 0;
    
    this.startTimer();

    try {
      this.loadingStep = '📡 Vérification du cache...';
      this.progress = 5;

      const resp = await this.api.search(
        this.what.trim(),
        this.where.trim(),
        this.maxPages,
        false
      );

      this.rowsServicePublic = resp.rows.filter(r => r.source === 'Service-Public');
      this.rowsMaSecurite = resp.rows.filter(r => r.source !== 'Service-Public');

      this.progress = 100;
      
      if (resp.fromCache) {
        this.loadingStep = `💾 ${resp.rows.length} résultats (cache, ${resp.cacheAge}s)`;
      } else {
        this.loadingStep = `✅ ${resp.rows.length} résultats trouvés !`;
      }

      this.saveToHistory(this.what.trim(), this.where.trim(), resp.rows.length);

      console.log(`✅ Service-Public: ${this.rowsServicePublic.length}`);
      console.log(`✅ MaSécurité: ${this.rowsMaSecurite.length}`);

      await this.wait(1000);

    } catch (e: any) {
      this.errorServicePublic = e?.error?.error || e?.message || 'Erreur de recherche';
      console.error('❌ Erreur:', e);
    } finally {
      this.loadingServicePublic = false;
      this.loadingStep = '';
      this.stopTimer();
    }
  }

  async onSearchForceRefresh() {
    if (!this.what.trim()) {
      this.errorServicePublic = 'Veuillez entrer un terme de recherche';
      return;
    }

    this.errorServicePublic = '';
    this.errorMaSecurite = '';
    this.rowsServicePublic = [];
    this.rowsMaSecurite = [];
    this.logs = [];
    this.loadingServicePublic = true;
    this.progress = 0;
    this.showLogs = true;
    this.totalDuration = 0;
    
    this.startTimer();

    try {
      this.loadingStep = '🔄 Actualisation forcée...';
      this.progress = 5;

      const resp = await this.api.search(
        this.what.trim(),
        this.where.trim(),
        this.maxPages,
        true
      );

      this.rowsServicePublic = resp.rows.filter(r => r.source === 'Service-Public');
      this.rowsMaSecurite = resp.rows.filter(r => r.source !== 'Service-Public');

      this.progress = 100;
      this.loadingStep = `✅ ${resp.rows.length} résultats trouvés (actualisés) !`;

      this.saveToHistory(this.what.trim(), this.where.trim(), resp.rows.length);

      await this.wait(1000);

    } catch (e: any) {
      this.errorServicePublic = e?.error?.error || e?.message || 'Erreur de recherche';
      console.error('❌ Erreur:', e);
    } finally {
      this.loadingServicePublic = false;
      this.loadingStep = '';
      this.stopTimer();
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

  async onExportCsvFused() {
    const allRows = [...this.rowsServicePublic, ...this.rowsMaSecurite];
    
    if (allRows.length === 0) {
      alert('Aucun résultat à exporter');
      return;
    }

    try {
      const cols = ['source', 'nom', 'adresse', 'telephone', 'ville', 'type', 'region', 'statut', 'email', 'site', 'url'];
      const escapeCSV = (val: any) => {
        const str = String(val ?? '').replace(/\r?\n/g, ' ').trim();
        if (str.includes(',') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      
      const header = cols.join(',');
      const body = allRows.map(r => cols.map(c => escapeCSV((r as any)[c])).join(',')).join('\n');
      const csv = '\ufeff' + header + '\n' + body;
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fusion_${this.what.replace(/\s+/g, '_')}_${allRows.length}_resultats.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      console.log(`✅ CSV fusionné exporté: ${allRows.length} lignes`);
    } catch (e) {
      alert('Export CSV fusionné échoué.');
      console.error(e);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}