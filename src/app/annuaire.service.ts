import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
export interface Row { nom:string; url:string; adresse?:string; telephone?:string; site?:string; region?:string; }

@Injectable({ providedIn: 'root' })
export class AnnuaireService {
  constructor(private http:HttpClient){}
  async search(what:string,where?:string){
    const params=new HttpParams().set('what',what).set('where',where??'');
    return firstValueFrom(this.http.get<{count:number,rows:Row[]}>('/api/scrape',{params}));
  }
  downloadExcel(what:string,where?:string){
    const params=new HttpParams().set('what',what).set('where',where??'').set('format','xlsx');
    return this.http.get('/api/scrape',{params,responseType:'blob'});
  }
}
