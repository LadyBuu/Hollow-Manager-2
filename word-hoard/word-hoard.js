(function(){
'use strict';
const DB_NAME='hollow-word-hoard',DB_VERSION=2,STORE='words';
let dbPromise;
function openDatabase(){
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  if(!indexedDB){reject(new Error('IndexedDB is unavailable in this browser.'));return;}
  const request=indexedDB.open(DB_NAME,DB_VERSION);
  request.onupgradeneeded=event=>{
   const db=request.result;
   const store=db.objectStoreNames.contains(STORE)
    ?request.transaction.objectStore(STORE)
    :db.createObjectStore(STORE,{keyPath:'key'});
   if(event.oldVersion<2&&event.oldVersion>0){
    const cursorRequest=store.openCursor();
    cursorRequest.onsuccess=()=>{
     const cursor=cursorRequest.result;if(!cursor)return;
     const record=cursor.value,word=normaliseWord(record.word);
     if(!word){cursor.delete();}
     else{cursor.update({...record,key:word.toLocaleLowerCase(),word});}
     cursor.continue();
    };
   }
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error('Could not open the word database.'));
  request.onblocked=()=>reject(new Error('The database is blocked by another open tab. Close other Word Hoard tabs and retry.'));
 });
 return dbPromise;
}
function normaliseWord(value){
 let word=String(value??'').normalize('NFKC').trim();
 word=word.replace(/\[.*$/u,'').trim();
 if(!word||/\p{N}/u.test(word))return '';
 word=word.replace(/^[^\p{L}]+|[^\p{L}\p{M}'’\-]+$/gu,'').trim();
 if(!word||!/\p{L}/u.test(word))return '';
 const first=word.search(/\p{L}/u);
 return word.slice(0,first)+word.charAt(first).toLocaleUpperCase()+word.slice(first+1);
}
function cleanToken(value){return normaliseWord(value);}
function parseText(text,options={}){
 let source=String(text??'');
 if(options.html||/<\s*(?:html|body|p|div|br|li|h[1-6])\b/i.test(source)){
  source=new DOMParser().parseFromString(source,'text/html').body.textContent||'';
 }else{
  source=source.replace(/^\s{0,3}[\x60]{3,}.*$/gm,' ').replace(/^\s{0,3}#{1,6}\s+/gm,' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,' ').replace(/[*_~>#|]/g,' ');
 }
 const words=[],seen=new Set();let duplicates=0;
 for(const part of source.split(/[\s,;]+/u)){
  const word=cleanToken(part);if(!word)continue;
  const key=word.toLocaleLowerCase();if(seen.has(key)){duplicates++;continue;}seen.add(key);words.push({key,word});
 }
 words.duplicates=duplicates;return words;
}
async function count(){
 const db=await openDatabase();return new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).count();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
async function addText(text,options={}){
 const incoming=parseText(text,options);if(!incoming.length)return{added:0,duplicates:incoming.duplicates||0,total:await count()};
 const db=await openDatabase();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);let added=0,duplicates=0;
  for(const entry of incoming){const r=store.add({...entry,addedAt:Date.now()});r.onsuccess=()=>added++;r.onerror=event=>{if(r.error&&r.error.name==='ConstraintError'){duplicates++;event.preventDefault();event.stopPropagation();}};}
  tx.oncomplete=()=>count().then(total=>resolve({added,duplicates:(incoming.duplicates||0)+incoming.length-added,total})).catch(reject);
  tx.onerror=()=>reject(tx.error||new Error('Could not save imported words.'));
  tx.onabort=()=>reject(tx.error||new Error('Import was cancelled.'));
 });
}
async function getAll(){
 const db=await openDatabase();return new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});
}
function randomIndex(max){if(window.crypto&&window.crypto.getRandomValues){const a=new Uint32Array(1);window.crypto.getRandomValues(a);return Math.floor(a[0]/4294967296*max);}return Math.floor(Math.random()*max);}
async function random(amount=1){
 const entries=await getAll(),pool=entries.slice(),result=[],wanted=Math.max(1,Math.min(100,Number(amount)||1));
 for(let i=0;i<Math.min(wanted,pool.length);i++){const index=randomIndex(pool.length);result.push(pool[index].word);pool.splice(index,1);}
 return result;
}
async function importJSON(text){
 const data=JSON.parse(text),words=Array.isArray(data)?data:data&&Array.isArray(data.words)?data.words:null;
 if(!words)throw new Error('This JSON file does not contain a words array.');
 return addText(words.map(item=>typeof item==='string'?item:item&&item.word?item.word:'').join('\n'));
}
async function exportJSON(){const entries=await getAll();return JSON.stringify({version:1,exportedAt:new Date().toISOString(),words:entries.map(entry=>entry.word)},null,2);}
async function clear(){const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Could not clear database.'));});}
window.WordHoard=Object.freeze({openDatabase,parseText,addText,getAll,count,random,importJSON,exportJSON,clear});
const $=id=>document.getElementById(id);\n// This script also supplies the Word Hoard API to the main app.\n// Bind page controls only on the standalone Word Hoard page.\nif ($('add-button')) {\nlet lastResult=[];
function status(id,message,error=false){const el=$(id);el.textContent=message;el.style.color=error?'var(--danger)':'';}
async function refreshCount(){const total=await count();$('word-count').textContent=total.toLocaleString();$('storage-status').textContent='Saved in this browser · IndexedDB';return total;}
function showWords(words){
 const box=$('random-result');box.replaceChildren();
 if(!words.length){const el=document.createElement('span');el.className='placeholder';el.textContent='The hoard is empty. Feed it first.';box.append(el);$('copy-button').disabled=true;lastResult=[];return;}
 words.forEach(word=>{const el=document.createElement('span');el.className='random-word';el.textContent=word;box.append(el);});
 lastResult=words;$('copy-button').disabled=false;
}
async function add(text,options={}){
 if(!String(text).trim()){status('add-feedback','There is nothing to add.');return;}
 status('add-feedback','Adding…');
 try{const result=await addText(text);status('add-feedback','Added '+result.added.toLocaleString()+' · skipped '+result.duplicates.toLocaleString()+' duplicates');if(options.clear)$('word-input').value='';await refreshCount();}
 catch(error){status('add-feedback',error.message||'Import failed.',true);}
}
$('add-button').addEventListener('click',()=>add($('word-input').value,{clear:true}));
$('file-input').addEventListener('change',async event=>{
 const file=event.target.files&&event.target.files[0];if(!file)return;
 try{const text=await file.text();if(/\.json$/i.test(file.name)){const result=await importJSON(text);status('add-feedback','Added '+result.added.toLocaleString()+' · skipped '+result.duplicates.toLocaleString()+' duplicates');await refreshCount();}else{await add(text);}}catch(error){status('add-feedback',error.message||'Could not read file.',true);}event.target.value='';
});
$('random-button').addEventListener('click',async()=>{
 try{const amount=Math.max(1,Math.min(100,Number($('random-count').value)||1));$('random-count').value=amount;const words=await random(amount);showWords(words);if(!words.length)status('add-feedback','The hoard is empty. Add some words first.');}
 catch(error){status('storage-status',error.message||'Could not retrieve words.',true);}
});
$('copy-button').addEventListener('click',async()=>{if(!lastResult.length)return;try{await navigator.clipboard.writeText(lastResult.join('\n'));status('backup-feedback','Copied to clipboard.');}catch(error){status('backup-feedback','Clipboard access was blocked by the browser.',true);}});
$('export-button').addEventListener('click',async()=>{
 try{const blob=new Blob([await exportJSON()],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='word-hoard.json';link.click();URL.revokeObjectURL(url);status('backup-feedback','JSON backup exported.');}
 catch(error){status('backup-feedback',error.message||'Export failed.',true);}
});
$('backup-input').addEventListener('change',async event=>{
 const file=event.target.files&&event.target.files[0];if(!file)return;
 try{const result=await importJSON(await file.text());status('backup-feedback','Merged backup: added '+result.added.toLocaleString()+', skipped '+result.duplicates.toLocaleString()+' duplicates.');await refreshCount();}
 catch(error){status('backup-feedback',error.message||'Could not import backup.',true);}event.target.value='';
});
$('clear-button').addEventListener('click',async()=>{
 if(!confirm('Delete every word in the hoard from this browser? This cannot be undone.'))return;
 try{await clear();showWords([]);await refreshCount();status('backup-feedback','The hoard has been cleared.');}
 catch(error){status('backup-feedback',error.message||'Could not clear database.',true);}
});
openDatabase().then(refreshCount).catch(error=>{status('storage-status',error.message||'Database unavailable.',true);status('add-feedback','Storage is unavailable in this browser.',true);});
}\n})();