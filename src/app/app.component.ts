import { Component } from '@angular/core';
import { AnnuaireService, Row } from './annuaire.service';

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
  rows: Row[] = [];
  total = 0;
  loading = false;
  error = '';
  
  // États de progression
  loadingStep = '';
  progress = 0;

  constructor(private api: AnnuaireService) {}

  async onSearch() {
    if (!this.what.trim()) {
      this.error = 'Veuillez entrer un terme de recherche';
      return;
    }

    this.error = '';
    this.loading = true;
    this.rows = [];
    this.total = 0;
    this.progress = 0;
    this.loadingStep = 'Initialisation...';

    try {
      // Simuler les étapes (en temps réel côté backend)
      const startTime = Date.now();
      
      // Étape 1
      this.loadingStep = '📡 Connexion à Service-Public.fr...';
      this.progress = 10;
      await this.wait(500);

      // Étape 2
      this.loadingStep = '🔍 Recherche des résultats...';
      this.progress = 20;
      await this.wait(500);

      // Étape 3
      this.loadingStep = '🔗 Collecte des liens des organismes...';
      this.progress = 40;

      // Lancer la vraie requête
      const resp = await this.api.search(
        this.what.trim(),
        this.where.trim(),
        Number(this.maxPages)
      );

      // Étape 4
      this.loadingStep = '📥 Extraction des données...';
      this.progress = 70;
      await this.wait(300);

      // Étape 5
      this.loadingStep = '✨ Finalisation...';
      this.progress = 90;

      this.rows = resp.rows ?? [];
      this.total = resp.count ?? this.rows.length;

      // Étape finale
      this.progress = 100;
      this.loadingStep = `✅ ${this.rows.length} résultats trouvés !`;
      
      console.log(`✅ ${this.rows.length} résultats reçus`);
      if (resp.duration) {
        console.log(`⏱️ Durée: ${resp.duration}`);
      }

      await this.wait(500);

    } catch (e: any) {
      this.error = e?.error?.error || e?.message || 'Erreur de recherche';
      console.error('❌ Erreur:', e);
      this.loadingStep = '';
      this.progress = 0;
    } finally {
      this.loading = false;
      this.loadingStep = '';
    }
  }

  async onExportCsv() {
    if (!this.what.trim()) return;
    try {
      this.loading = true;
      this.loadingStep = '📄 Génération du fichier CSV...';
      
      const blob = await this.api.downloadCsv(
        this.what.trim(),
        this.where.trim(),
        Number(this.maxPages)
      );
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annuaire_${this.what.replace(/\s+/g, '_')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export CSV échoué.');
      console.error(e);
    } finally {
      this.loading = false;
      this.loadingStep = '';
    }
  }

  async onExportXlsx() {
    if (!this.what.trim()) return;
    try {
      this.loading = true;
      this.loadingStep = '📊 Génération du fichier Excel...';
      
      const blob = await this.api.downloadXlsx(
        this.what.trim(),
        this.where.trim(),
        Number(this.maxPages)
      );
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annuaire_${this.what.replace(/\s+/g, '_')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export XLSX échoué.');
      console.error(e);
    } finally {
      this.loading = false;
      this.loadingStep = '';
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}