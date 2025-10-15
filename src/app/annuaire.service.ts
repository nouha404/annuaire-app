import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';

export interface Row {
  source: string;
  nom: string;
  adresse: string;
  telephone: string;
  ville: string;
  type: string;
  email?: string;
  site?: string;
  region?: string;
  latitude?: string;
  longitude?: string;
  statut?: string;
  url?: string;
}

export interface SearchResponse {
  success: boolean;
  rows: Row[];
  stats: {
    total: number;
    servicePublic: number;
    maSecurite: number;
  };
  sessionId: string;
}

@Injectable({ providedIn: 'root' })
export class AnnuaireService {
  // ✅ base vide => appels relatifs sur le même domaine (Railway)
  private readonly base = '';

  private logSubject = new Subject<string>();
  public logs$ = this.logSubject.asObservable();
  private eventSource: EventSource | null = null;

  constructor(private http: HttpClient) {}

  /** Démarre l'écoute des logs SSE */
  startListeningLogs(sessionId: string): void {
    this.stopListeningLogs(); // Arrêter l'ancien si existe
    // ✅ URL relative (pas de localhost)
    this.eventSource = new EventSource(`${this.base}/api/logs/${sessionId}`);

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') this.logSubject.next(data.message);
      } catch (e) {
        // on ne relance pas la SSE pour un log malformé
      }
    };

    this.eventSource.onerror = () => {
      this.stopListeningLogs();
    };
  }

  /** Arrête l'écoute des logs */
  stopListeningLogs(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /** Recherche unifiée avec génération de sessionId */
  async search(what: string, where: string, maxPages: number): Promise<SearchResponse> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.startListeningLogs(sessionId);

    try {
      // ✅ URL relative (pas de localhost)
      const response = await this.http.post<SearchResponse>(
        `${this.base}/api/search`,
        { what, where, maxPages, sessionId }
      ).toPromise();

      return response!;
    } finally {
      setTimeout(() => this.stopListeningLogs(), 30000);
    }
  }

  /** Téléchargement XLSX */
  async downloadXlsx(what: string, where: string, maxPages: number): Promise<Blob> {
    // ✅ URL relative (pas de localhost)
    const response = await this.http.post(
      `${this.base}/api/download/xlsx`,
      { what, where, maxPages },
      { responseType: 'blob' }
    ).toPromise();

    return response!;
  }
}
