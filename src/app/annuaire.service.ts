import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';

const API = 'http://localhost:3000/api';

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

@Injectable({
  providedIn: 'root',
})
export class AnnuaireService {
  private logSubject = new Subject<string>();
  public logs$ = this.logSubject.asObservable();
  
  private eventSource: EventSource | null = null;

  constructor(private http: HttpClient) {}

  /**
   * Démarre l'écoute des logs SSE
   */
  startListeningLogs(sessionId: string): void {
    this.stopListeningLogs(); // Arrêter l'ancien si existe
    
    this.eventSource = new EventSource(`${API}/logs/${sessionId}`);
    
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          this.logSubject.next(data.message);
        }
      } catch (e) {
        console.error('Erreur parsing log:', e);
      }
    };
    
    this.eventSource.onerror = (error) => {
      console.error('Erreur SSE:', error);
      this.stopListeningLogs();
    };
  }

  /**
   * Arrête l'écoute des logs
   */
  stopListeningLogs(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Recherche unifiée avec génération de sessionId
   */
  async search(what: string, where: string, maxPages: number): Promise<SearchResponse> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Démarrer l'écoute des logs AVANT la recherche
    this.startListeningLogs(sessionId);
    
    try {
      const response = await this.http
        .post<SearchResponse>(`${API}/search`, {
          what,
          where,
          maxPages,
          sessionId
        })
        .toPromise();
      
      return response!;
    } finally {
      // Arrêter l'écoute après 30 secondes
      setTimeout(() => {
        this.stopListeningLogs();
      }, 30000);
    }
  }

  /**
   * Téléchargement XLSX
   */
  async downloadXlsx(what: string, where: string, maxPages: number): Promise<Blob> {
    const response = await this.http
      .post(`${API}/download/xlsx`, { what, where, maxPages }, {
        responseType: 'blob',
      })
      .toPromise();
    
    return response!;
  }
}