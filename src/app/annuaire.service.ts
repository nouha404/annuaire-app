import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type Row = {
  nom: string;
  adresse?: string;
  telephone?: string;
  email?: string;
  site?: string;
  region?: string;
  latitude?: string;
  longitude?: string;
  url?: string;
};

export type ScrapeResp = { count: number; rows: Row[]; duration?: string };

@Injectable({ providedIn: 'root' })
export class AnnuaireService {
  constructor(private http: HttpClient) {}

  async search(what: string, where = '', maxPages = 5): Promise<ScrapeResp> {
    const p = new HttpParams()
      .set('what', what)
      .set('where', where)
      .set('maxPages', String(maxPages));
    
    return await firstValueFrom(
      this.http.get<ScrapeResp>('/api/scrape', { params: p })
    );
  }

  async downloadCsv(what: string, where = '', maxPages = 5): Promise<Blob> {
    const p = new HttpParams()
      .set('what', what)
      .set('where', where)
      .set('maxPages', String(maxPages))
      .set('format', 'csv');
    
    return await firstValueFrom(
      this.http.get('/api/scrape', { params: p, responseType: 'blob' })
    );
  }

  async downloadXlsx(what: string, where = '', maxPages = 5): Promise<Blob> {
    const p = new HttpParams()
      .set('what', what)
      .set('where', where)
      .set('maxPages', String(maxPages))
      .set('format', 'xlsx');
    
    return await firstValueFrom(
      this.http.get('/api/scrape', { params: p, responseType: 'blob' })
    );
  }
}