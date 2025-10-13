import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export type Row = {
  nom: string;
  adresse?: string;
  telephone?: string;
  site_web?: string;
  nom_commune?: string;
  url?: string;
};

type V21Response = {
  total_count: number;
  results: any[];
};

@Injectable({ providedIn: 'root' })
export class AnnuaireService {
  private base = environment.API_BASE;   // "https://api-lannuaire.service-public.fr"
  private dataset = environment.DATASET; // "api-lannuaire-administration"

  constructor(private http: HttpClient) {}

  /** Recherche v2.1 avec q, limit (<=100), offset */
  async search(what: string, where?: string, limit = 100, offset = 0) {
    const q = this.qExpr(what, where);
    const params = new HttpParams()
      .set('limit', String(Math.min(Math.max(limit, 1), 100)))
      .set('offset', String(Math.max(offset, 0)))
      .set('q', q);

    const url = `${this.base}/api/explore/v2.1/catalog/datasets/${this.dataset}/records`;
    const r = await firstValueFrom(this.http.get<V21Response>(url, { params }));
    const results = (r.results ?? []).map((it) => this.mapRecordV21(it));
    return { total_count: r.total_count ?? results.length, results };
  }

  /** CSV généré par l’API v2.1 (respecte limit<=100, utilise offset si tu veux paginer côté client) */
  async downloadCsv(what: string, where?: string, limit = 100, offset = 0) {
    const q = this.qExpr(what, where);
    const params = new HttpParams()
      .set('limit', String(Math.min(Math.max(limit, 1), 100)))
      .set('offset', String(Math.max(offset, 0)))
      .set('q', q)
      .set('format', 'csv');

    const url = `${this.base}/api/explore/v2.1/catalog/datasets/${this.dataset}/records`;
    return firstValueFrom(this.http.get(url, { params, responseType: 'blob' }));
  }

  /** XLSX côté front (ESM friendly) */
  async makeXlsxBlob(rows: Row[]) {
    const XLSX = (await import('xlsx')).default;
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Annuaire');
    const ab = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return new Blob([ab], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  // -------- helpers --------

  private qExpr(what: string, where?: string) {
    const parts = [what?.trim(), where?.trim()].filter(Boolean);
    return parts.join(' ');
  }

  /** v2.1 item -> Row (parse les champs JSON stringifiés) */
  private mapRecordV21(item: any): Row {
    const obj = item ?? {};

    const nom: string = this.pick(obj, ['nom', 'intitule', 'libelle', 'label', 'name']) ?? '—';
    const url =
      this.pick(obj, ['url_service_public', 'url', 'permalink', 'lien_detail']) ?? undefined;

    // adresse: souvent string JSON d’un tableau d’objets
    const adresseRaw = this.pick(obj, ['adresse', 'adresse_postale', 'adresses']);
    const adresse = this.formatAdresse(adresseRaw);

    // telephone: souvent string JSON d’un tableau [{ valeur: "..." }]
    const telRaw = this.pick(obj, ['telephone', 'tel', 'phone', 'numero_telephone']);
    const telephone = this.formatTelephone(telRaw);

    // site_internet: string JSON d’un tableau [{ valeur: "..." }]
    const siteRaw = this.pick(obj, ['site_internet', 'site', 'site_web', 'web', 'url_site']);
    const site_web = this.firstUrl(siteRaw);

    // commune (si présent dans le 1er bloc adresse)
    const nom_commune = this.extractCommune(adresseRaw);

    return { nom, adresse, telephone, site_web, nom_commune, url };
  }

  private pick(o: any, keys: string[]) {
    for (const k of keys) {
      if (o?.[k] != null && o?.[k] !== '') return o[k];
      // tolérance : clefs proches (minuscules/underscores)
      const found = Object.keys(o ?? {}).find(
        (kk) => kk.toLowerCase().includes(k.toLowerCase())
      );
      if (found && o[found] != null && o[found] !== '') return o[found];
    }
    return undefined;
  }

  private maybeParseJSON(value: any) {
    if (typeof value !== 'string') return value;
    const s = value.trim();
    if (!(s.startsWith('[') || s.startsWith('{'))) return value;
    try {
      return JSON.parse(s);
    } catch {
      return value;
    }
  }

  private formatAdresse(raw: any) {
    const v = this.maybeParseJSON(raw);
    if (Array.isArray(v) && v.length) {
      // on prend la première adresse "type_adresse" si possible
      const a = v.find((x) => x.type_adresse?.toLowerCase().includes('adresse')) ?? v[0];
      const parts = [
        a?.numero_voie,
        a?.complement1,
        a?.complement2,
        a?.service_distribution,
        a?.nom_commune,
        a?.code_postal
      ]
        .filter(Boolean)
        .join(', ');
      return parts || undefined;
    }
    if (typeof v === 'object' && v) {
      const parts = [
        v?.numero_voie,
        v?.complement1,
        v?.complement2,
        v?.service_distribution,
        v?.nom_commune,
        v?.code_postal
      ]
        .filter(Boolean)
        .join(', ');
      return parts || undefined;
    }
    // fallback: rendre tel quel
    return typeof raw === 'string' ? raw : undefined;
  }

  private formatTelephone(raw: any) {
    const v = this.maybeParseJSON(raw);
    if (Array.isArray(v) && v.length) {
      // retourne la première valeur non vide
      const val = v.map((x) => x?.valeur).find((s) => !!s);
      return val || undefined;
    }
    if (typeof v === 'string' && v) return v;
    return undefined;
  }

  private firstUrl(raw: any) {
    const v = this.maybeParseJSON(raw);
    if (Array.isArray(v) && v.length) {
      const val = v.map((x) => x?.valeur).find((s) => !!s);
      return val || undefined;
    }
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
    return undefined;
  }

  private extractCommune(raw: any) {
    const v = this.maybeParseJSON(raw);
    if (Array.isArray(v) && v.length) {
      const a = v[0];
      return a?.nom_commune || undefined;
    }
    if (typeof v === 'object' && v) {
      return v?.nom_commune || undefined;
    }
    return undefined;
  }
}
