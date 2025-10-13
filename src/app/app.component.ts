import { Component } from '@angular/core';
import { AnnuaireService, Row } from './annuaire.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html'
})
export class AppComponent {
  title = 'annuaire-app';
  what = 'Peloton';
  where = '';
  rows: Row[] = [];
  loading = false;
  error = '';
  total = 0;

  // pagination simple
  private offset = 0;
  readonly pageSize = 100;

  constructor(private api: AnnuaireService) {}

  async onSearch() {
    this.error = '';
    this.loading = true;
    this.rows = [];
    this.total = 0;
    this.offset = 0;
    try {
      const resp = await this.api.search(this.what.trim(), this.where.trim(), this.pageSize, this.offset);
      this.rows = resp.results ?? [];
      this.total = resp.total_count ?? this.rows.length;
    } catch (e: any) {
      this.error = e?.message || 'Erreur de recherche';
    } finally {
      this.loading = false;
    }
  }

  async onMore() {
    if (this.loading) return;
    this.loading = true;
    try {
      this.offset += this.pageSize;
      const resp = await this.api.search(this.what.trim(), this.where.trim(), this.pageSize, this.offset);
      this.rows = [...this.rows, ...(resp.results ?? [])];
    } catch (e: any) {
      this.error = e?.message || 'Erreur de pagination';
    } finally {
      this.loading = false;
    }
  }

  async onExportCsv() {
  try {
    const blob = this.api.makeCsvBlob(this.rows); // ← CSV clean côté front
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annuaire_${this.what.replace(/\s+/g,'_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    alert('Export CSV échoué.');
  }
}

async onExportXlsx() {
  try {
    const blob = await this.api.makeXlsxBlob(this.rows); // ← déjà async
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annuaire_${this.what.replace(/\s+/g,'_')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    alert('Export XLSX échoué.');
  }
}

async onExportCsvAll() {
  try {
    const { results } = await this.api.searchAll(this.what.trim(), this.where.trim());
    const blob = this.api.makeCsvBlob(results);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annuaire_${this.what.replace(/\s+/g,'_')}_all.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    alert('Export CSV (tout) échoué.');
  }
}


}
