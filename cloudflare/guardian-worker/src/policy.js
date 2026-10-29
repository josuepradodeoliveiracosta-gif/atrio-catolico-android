// Átrio Guardião V2: sinais conservadores. Sem inferência de culpabilidade.
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/;
export function cpfValid(digits) {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const check = len => {
    const sum = [...digits.slice(0,len)].reduce((t,d,i)=>t+Number(d)*(len+1-i),0);
    return (sum*10)%11%10;
  };
  return check(9)===Number(digits[9]) && check(10)===Number(digits[10]);
}
export function classify(text, context={}) {
  if(typeof text!=='string' || text.length>4000) return {level:'review',rule:'input_limit',confidence:'low'};
  const t=fold(text);
  const result=(level,rule,confidence)=>({level,rule,confidence});
  // Não transformar uma citação teológica, discussão ou relato em infração automática.
  const quote=/\b(evangelho|biblia|catecismo|citacao|citando|relato|denuncio|ameacou|ameaça recebida)\b/.test(t);
  const cpfs=(text.match(/\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}\b/g)||[]);
  if(cpfs.some(x=>cpfValid(x.replace(/\D/g,'')))) return result('review','personal_data','high');
  const url=/(?:https?:\/\/|www\.)\S+/i.test(text);
  const credential=/\b(senha|codigo de verificacao|token|pix|dados bancarios)\b/.test(t);
  const lure=/\b(envie|mande|informe|clique|confirme|atualize)\b/.test(t);
  if(url && credential && lure && !quote) return result('hold_candidate','possible_phishing','high');
  const threat=/\b(vou|iremos)\s+(?:te\s+|lhe\s+|voce\s+)?(?:matar|agredir|machucar)\b/.test(t);
  if(threat && !quote) return result('review','possible_threat','high');
  const links=(text.match(/https?:\/\/\S+/gi)||[]).length;
  if(links>=4) return result('warning','links_excessive','medium');
  if(context.duplicateCount>=3) return result('warning','repeated_content','medium');
  if(context.confirmedInfractions>=3 && context.duplicateCount>=5) return result('review','recurrence','medium');
  return result('clear','none','none');
}
export function decide(finding, settings, flags) {
  if(finding.level==='clear') return 'clear';
  if(finding.level==='warning') return 'warn';
  if(finding.level==='review'||finding.level==='hold_candidate') return 'review';
  return 'review';
}
export function safeNotice(rule,action) {
  const reasons={personal_data:'possível exposição de dados pessoais',possible_phishing:'possível tentativa de fraude',possible_threat:'possível ameaça',links_excessive:'excesso de links',repeated_content:'publicações repetidas',recurrence:'reincidência em conteúdo repetitivo'};
  const why=reasons[rule]||'conteúdo que requer verificação';
  return {title:'Átrio Guardião',body:'Sinal detectado: '+why+'. Medida: '+(action==='warn'?'orientação educativa.':'encaminhamento para revisão humana.')+' Você pode consultar a administração.',rule,action};
}