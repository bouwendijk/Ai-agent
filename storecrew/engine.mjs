const palettes={
  zwart:{bg:'#0b0f13',ink:'#f2f7f3',surface:'#202932',accent:'#bbff65'},
  minimal:{bg:'#f7f4ec',ink:'#212822',surface:'#e8e7df',accent:'#345b43'},
  luxe:{bg:'#171816',ink:'#f8f1e4',surface:'#302e29',accent:'#c9aa72'},
  beige:{bg:'#f8f1e7',ink:'#2c2824',surface:'#e9d9ca',accent:'#aa7452'},
  roze:{bg:'#fdf0f2',ink:'#392631',surface:'#f4dce6',accent:'#a53e67'},
  blauw:{bg:'#eef3f8',ink:'#172b43',surface:'#dce9f5',accent:'#1859b5'},
  paars:{bg:'#1d192e',ink:'#f5efff',surface:'#34304b',accent:'#c8a4ff'},
  groen:{bg:'#eff4ea',ink:'#1e3327',surface:'#dcebd6',accent:'#377a4d'},
  oranje:{bg:'#fdf6ee',ink:'#29211a',surface:'#f8e1c9',accent:'#dc702a'}
};
const color={zwart:'#101010',wit:'#ffffff',creme:'#f5ebda',crème:'#f5ebda',beige:'#e6d1ba',grijs:'#92969c',rood:'#d74737',oranje:'#f78d35',geel:'#ffd94f',groen:'#57ae67',neon:'#baff45',lime:'#baff45',blauw:'#3279df',donkerblauw:'#152b54',roze:'#ed8da7',paars:'#a480d7',goud:'#d4af6d',zilver:'#b9c0c4',bruin:'#986342'};
const kits=[
{match:/fitness|sport|gym|kracht|workout|sportschool|push.?up|training/i,niche:'fitness',brand:'PULSE ATHLETIC',products:['Push-up board','Resistance bands','Workout mat','Training kit'],nl:'Train met karakter.',en:'Built for your next move.',benefits:['Voor jouw trainingsroutine','Functionele essentials','Ontdek de collectie']},
{match:/sieraad|sieraden|juwel|ring|necklace|armband|jewelry|ketting/i,niche:'sieraden',brand:'AURA JEWELS',products:['Minimal ring','Statement necklace','Everyday bracelet','Layered chain'],nl:'Details die blijven.',en:'Wear the extraordinary.',benefits:['Ontdek jouw stijl','Veelzijdige ontwerpen','Shop de collectie']},
{match:/sneaker|schoenen|fashion|kleding|hoodie|streetwear/i,niche:'streetwear',brand:'FORME STUDIO',products:['Signature hoodie','Everyday sneaker','Essential tee','Classic cap'],nl:'Draag je eigen verhaal.',en:'Wear your own story.',benefits:['Moderne essentials','Jouw persoonlijke stijl','Ontdek meer']},
{match:/skincare|cosmet|huid|beauty|make.?up|serum/i,niche:'beauty',brand:'LUMIÈRE LAB',products:['Hydrating serum','Daily moisturizer','Gentle cleanser','Care set'],nl:'Een moment voor jezelf.',en:'Your ritual, reimagined.',benefits:['Eenvoudige routine','Jouw verzorgingsmoment','Ontdek de collectie']},
{match:/wonen|interieur|home|lamp|meubel|deco/i,niche:'interieur',brand:'HABIT HOME',products:['Sculptural vase','Soft throw','Table lamp','Design object'],nl:'Thuis begint hier.',en:'Live beautifully.',benefits:['Met oog voor stijl','Voor elke ruimte','Ontdek meer']},
{match:/tech|gadget|elektron|phone|laptop/i,niche:'gadgets',brand:'NOVA SUPPLY',products:['Desk charger','Cable organizer','Wireless stand','Tech organizer'],nl:'Slim gemaakt voor nu.',en:'Designed for what’s next.',benefits:['Slimme essentials','Praktisch ontwerp','Ontdek de collectie']},
{match:/dieren|hond|kat|pet /i,niche:'huisdieren',brand:'PAWS & CO',products:['Cozy pet bed','Everyday leash','Play toy','Travel bowl'],nl:'Voor jouw beste maatje.',en:'For their best life.',benefits:['Voor dagelijks gebruik','Spelen en ontdekken','Shop de collectie']}
];
const letters='a-zA-ZÀ-ÿ0-9 &-';
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
const s=(v,n=220)=>String(v??'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,n);
export function revise(raw={},message=''){
 const old={...raw},p={...old},q=s(message,1100),lower=q.toLowerCase();
 const initial=/maak|bouw|begin|start|ontwerp|genereer/.test(lower)&&(/webshop|winkel|site|thema/.test(lower)||(!old.brand||old.brand==='AETHER STUDIO'));
 const kit=kits.find(x=>x.match.test(q));
 const containsColor=/kleur|kleuren|achtergrond|knop|button|accent|tekst|tekstcolor|letters|letters|kleurstelling|palette|palet/.test(lower);
 const visibleColors=Object.entries(color).filter(([name])=>new RegExp('(^|\\W)'+name+'(?=$|\\W)','i').test(lower));
 const hexes=[...q.matchAll(/#[a-f0-9]{6}\b/gi)].map(x=>x[0]);
 const target=/(?:knop|button|cta|accent)/.test(lower)?'accent':/(?:achtergrond|background)/.test(lower)?'bg':/(?:letters|tekst.*kleur|fontcolor)/.test(lower)?'ink':null;
 const style=/(minimal|clean|rustig|simpel)/.test(lower)?'minimal':/(luxe|luxury|premium|chique|elegant|goud)/.test(lower)?'luxe':/(brutaal|stoer|dark|donker|zwart|neon|sport)/.test(lower)?'zwart':/(pastel|zacht|beige|crème)/.test(lower)?'beige':/(futurist|sci.?fi)/.test(lower)?'paars':null;
 let touched=[];
 if(initial&&kit){
   Object.assign(p,{brand:kit.brand,niche:kit.niche,products:[...kit.products],hero:kit.nl,subtitle:'Een met aandacht samengestelde collectie voor jouw dagelijkse routine.',collectionHeading:'Ontdek de collectie',benefits:[...kit.benefits],storyHeading:'Een andere kijk op '+kit.niche+'.',storyText:'Ontdek ontwerpen met karakter en kies wat bij jou past.',eyebrow:kit.brand+' / COLLECTIE',cta:'Ontdek de collectie'});touched.push('de winkel en de productvoorbeelden');
 }
 if(initial&&(!kit)){
  const category=q.match(/(?:voor|met)\s+(?:een\s+)?(?:luxe\s+|premium\s+)?([\p{L} ]{3,26}?)\s+webshop/iu)||q.match(/webshop\s+(?:voor|met)\s+([\p{L} ]{3,28})/iu);
  if(category){p.niche=s(category[1],55);p.hero=cap(p.niche)+'. Op jouw manier.';p.collectionHeading='Onze '+p.niche;p.products=['Signature '+p.niche,'Essential '+p.niche,'Everyday '+p.niche,'The collection'];touched.push('de productrichting')}
 }
 const brand=q.match(/(?:noem (?:het|de (?:winkel|shop))|merknaam(?: moet zijn| is)?|brand(?:name)?(?: is)?|de (?:naam|winkel) is|brand name)[:\s]+["“]?([\p{L}0-9 &'-]{2,45})/iu);
 if(brand){p.brand=s(brand[1].replace(/\s+(?:en |met |in |voor ).*$/i,''),45);p.eyebrow=p.brand.toUpperCase()+' / COLLECTIE';touched.push('de merknaam')}
 const english=/(?:\bengels\b|\benglish\b|in het engels|all in english)/i.test(lower);
 const dutch=/(?:\bnederlands\b|\bdutch\b|in het nederlands)/i.test(lower);
 if(english||dutch){p.language=english?'en':'nl';touched.push('de taal'); if(english){p.hero=kit?.en||'Designed to stand out.';p.subtitle='Discover a considered collection made for your everyday life.';p.cta='Shop the collection';p.collectionHeading='The collection';p.benefits=['Curated for you','Everyday essentials','Explore the collection'];p.storyHeading='Designed for your world.';p.storyText='Discover a thoughtfully chosen collection with a distinctive point of view.'}else{p.hero=kit?.nl||'Meer dan gewoon.';p.subtitle='Ontdek een zorgvuldig geselecteerde collectie.';p.cta='Ontdek de collectie';p.collectionHeading='De collectie';p.benefits=['Met aandacht gekozen','Voor elke dag','Ontdek de collectie'];p.storyHeading='Ontworpen voor jouw wereld.';p.storyText='Een collectie waarin eenvoud en stijl samenkomen.'}}
 if(kit&&(initial||/(?:andere |nieuwe )?(?:niche|producten|webshop)/.test(lower))){if(!initial){p.niche=kit.niche;p.products=[...kit.products];touched.push('de producten')}}
 if((style||kit)&&(initial||/maak|verander|zet|ontwerp|bouw|stijl|thema/.test(lower))&&!/(?:alleen (?:de )?(?:knop|button|cta|tekst)|verander verder niets)/.test(lower)){
  const pal=palettes[style||(kit?.niche==='fitness'?'zwart':kit?.niche==='sieraden'?'luxe':'minimal')];
  if(pal){Object.assign(p,pal);touched.push('de stijl')}
 }
 if(containsColor||hexes.length){
   let chosen=hexes[0]||visibleColors[0]?.[1];
   if(chosen){
    if(target){p[target]=chosen;touched.push(target==='accent'?'de knopkleur':target==='bg'?'de achtergrondkleur':'de tekstkleur')}
    else if(/(?:alleen|accent|kleur van)/.test(lower)){p.accent=chosen;touched.push('de accentkleur')}
    else{p.accent=chosen;touched.push('de accentkleur')}
   }
   if(/donkere achtergrond|dark background|achtergrond zwart|zwarte achtergrond/.test(lower)){p.bg='#111214';p.ink='#f7f8f4';p.surface='#292e33';touched.push('de donkere achtergrond')}
   if(/lichte achtergrond|witte achtergrond|achtergrond wit/.test(lower)){p.bg='#ffffff';p.ink='#202423';p.surface='#f0f0ec';touched.push('de lichte achtergrond')}
 }
 const words=q.match(/(?:zet|voeg|gebruik|toon|maak)\s+(\d{1,2})\s+producten/i);
 if(words){const n=Math.min(8,Math.max(1,+words[1]));p.products=Array.from({length:n},(_,i)=>p.products?.[i]||'Essential '+(i+1));touched.push(n+' producttegels')}
 const products=q.match(/(?:producten? (?:zijn|worden|:)|met producten?:?)\s*([\p{L}0-9 ,&'-]{8,130})/iu);
 if(products&&/[,;]+/.test(products[1])){p.products=products[1].split(/[,;]/).map(x=>s(x,55)).filter(Boolean).slice(0,8);touched.push('de productnamen')}
 const hero=q.match(/(?:hoofdtitel|hero(?:tekst|titel| title)?|headline)\s*(?:is|wordt|:)\s*["“]?([^"\n”]{4,110})/iu);
 if(hero&&!/(?:mooier|luxer|korter|duidelijker)/i.test(hero[1])){p.hero=s(hero[1].replace(/[.]+\s*(?:en|verder).*$/i,''),110);touched.push('de hoofdtitel')}
 else if(/(?:maak|verander).*(?:hero|hoofdtitel).*(?:mooier|luxer|sterker|krachtiger|professioneler)/i.test(q)){p.hero=p.language==='en'?'More than ordinary.':'Een klasse apart.';touched.push('de hoofdtitel')}
 const subtitle=q.match(/(?:ondertitel|subtitel|subtitle)\s*(?:is|wordt|:)\s*["“]?([^"\n”]{5,155})/iu);
 if(subtitle){p.subtitle=s(subtitle[1],155);touched.push('de ondertitel')}
 const cta=q.match(/(?:buttontekst|knoptekst|cta(?:-tekst)?)\s*(?:is|wordt|:)\s*["“]?([^"\n”]{2,55})/iu);
 if(cta){p.cta=s(cta[1],50);touched.push('de knoptekst')}
 if(!touched.length&&/(?:premium|mooier|luxe|beter|profess)/.test(lower)){p.bg=palettes.luxe.bg;p.ink=palettes.luxe.ink;p.surface=palettes.luxe.surface;p.accent=palettes.luxe.accent;touched.push('de premium kleuren')}
 if(!touched.length){return {spec:old,assistantMessage:'Ik kan kleuren, stijl, teksten, taal, merknaam, niche en producten gericht aanpassen. Beschrijf welke wijziging je wilt, bijvoorbeeld: maak de knoppen oranje en laat de rest hetzelfde.',mode:'built-in',changed:false}}
 p.language=p.language==='en'?'en':'nl';p.products=Array.isArray(p.products)?p.products.slice(0,8):[];p.benefits=Array.isArray(p.benefits)?p.benefits.slice(0,4):[];for(const k of ['bg','ink','surface','accent']){if(!/^#[a-f0-9]{6}$/i.test(p[k]||''))p[k]=old[k]}
 return {spec:p,assistantMessage:'Ik heb '+[...new Set(touched)].join(', ')+' aangepast. Bekijk de live preview; je kunt blijven verfijnen.',mode:'built-in',changed:true}
}
