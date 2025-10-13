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
  maxPages = 3; // Valeur par défaut
  rows: Row[] = [];
  total = 0;
  loading = false;
  error = '';

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

    try {
      const resp = await this.api.search(
        this.what.trim(),
        this.where.trim(),
        Number(this.maxPages) // Conversion en nombre
      );
      
      this.rows = resp.rows ?? [];
      this.total = resp.count ?? this.rows.length;
      
      console.log(`✅ ${this.rows.length} résultats reçus`);
      if (resp.duration) {
        console.log(`⏱️ Durée: ${resp.duration}`);
      }
    } catch (e: any) {
      this.error = e?.error?.error || e?.message || 'Erreur de recherche';
      console.error('❌ Erreur:', e);
    } finally {
      this.loading = false;
    }
  }

  async onExportCsv() {
    if (!this.what.trim()) return;
    
    try {
      this.loading = true;
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
    }
  }

  async onExportXlsx() {
    if (!this.what.trim()) return;
    
    try {
      this.loading = true;
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
    }
  }
}