import { Component } from '@angular/core';
import { AnnuaireService, Row } from './annuaire.service';
@Component({selector:'app-root',templateUrl:'./app.component.html'})
export class AppComponent{
  what='Peloton';where='';rows:Row[]=[];loading=false;error='';
  constructor(private api:AnnuaireService){}
  async onSearch(){
    this.error='';this.loading=true;this.rows=[];
    try{const {rows}=await this.api.search(this.what.trim(),this.where.trim());this.rows=rows;}
    catch(e:any){this.error=e?.message||'Erreur';}
    finally{this.loading=false;}
  }
  onExport(){
    this.api.downloadExcel(this.what.trim(),this.where.trim()).subscribe(blob=>{
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download=`annuaire_${this.what}.xlsx`;a.click();URL.revokeObjectURL(url);
    });
  }
}
