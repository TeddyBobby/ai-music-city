
const L={"createdNodeIds":["2:55","2:56","2:57","2:58","2:59","2:60","2:61","2:62","2:63","2:64","2:65","2:66","2:67","2:68","2:69","2:70","2:71","2:72","2:73","2:74","2:75","2:76","2:77","2:78","2:79","2:80","2:81","2:82","2:83","2:84","2:85","2:86","2:87","2:88","2:89","2:90","2:91","2:92","2:93","2:94","2:98","2:99","2:101","2:102","2:104","2:105","2:107","2:108","2:111","2:112","2:114","2:115","2:117","2:118","2:120","2:121","2:123","2:124","2:126","2:127","2:130","2:131","2:133","2:134","2:136","2:137","2:139","2:140","2:143","2:144","2:146","2:147","2:149","2:150","2:155","2:156","2:157","2:162","2:163","2:164","2:165","2:166","2:167","2:168","2:169","2:170","2:171","2:172","2:173","2:174"],"mutatedNodeIds":["0:1"],"screens":{"overview":"2:55","create":"2:56","progress":"2:57","library":"2:58","detail":"2:59","project":"2:60","queue":"2:61","settings":"2:62","states":"2:63"},"componentBoard":"2:64","masters":"2:67","components":{"button":{"主要":"2:68","次要":"2:70","文字":"2:72","危险":"2:74","禁用":"2:76","生成中":"2:78"},"badge":{"中性":"2:81","完成":"2:83","处理中":"2:85","未启用":"2:87","错误":"2:89"},"icons":{"music":"2:93","library":"2:98","folder":"2:101","queue":"2:104","settings":"2:107","play":"2:111","arrow":"2:114","check":"2:117","download":"2:120","plus":"2:123","search":"2:126","volume":"2:130","chevron":"2:133","spark":"2:136","lock":"2:139","previous":"2:143","next":"2:146"},"nav":{"默认":"2:149","选中":"2:156"},"input":"2:164","art":"2:166"},"props":{"button":"文字#2:0","badge":"文字#2:7","nav":"文字#2:13","navIcon":"图标#2:16","input":"内容#2:19"},"styles":{"标题":"S:b44a7fa43790d021d56dd71b647ba00f51f0efe3,","区块":"S:0936cec38dc48efa59c0186f1da7820b5d034eef,","小标题":"S:46c432308b81fb735180c1fdd3a855970b7e9008,","正文":"S:ee9e2bfa2cd14f084948f5f0f479e00dfce3746d,","标签":"S:159a8d78afba35d16cd74fd1c6f00db14779c074,","辅助":"S:a5121663779b36f35296c83e645945b1fd364da6,"},"collections":["VariableCollectionId:2:2","VariableCollectionId:2:19"],"variables":{"color/bg":"VariableID:2:20","color/sidebar":"VariableID:2:21","color/panel":"VariableID:2:22","color/panelAlt":"VariableID:2:23","color/field":"VariableID:2:24","color/line":"VariableID:2:25","color/ink":"VariableID:2:26","color/muted":"VariableID:2:27","color/subtle":"VariableID:2:28","color/accent":"VariableID:2:29","color/accentLow":"VariableID:2:30","color/onAccent":"VariableID:2:31","color/amber":"VariableID:2:32","color/red":"VariableID:2:33","color/redLow":"VariableID:2:34","color/cyan":"VariableID:2:35","space/4":"VariableID:2:36","space/8":"VariableID:2:37","space/12":"VariableID:2:38","space/16":"VariableID:2:39","space/24":"VariableID:2:40","space/32":"VariableID:2:41","space/40":"VariableID:2:42","radius/6":"VariableID:2:43","radius/10":"VariableID:2:44","radius/12":"VariableID:2:45","radius/16":"VariableID:2:46","radius/24":"VariableID:2:47","radius/999":"VariableID:2:48"},"palette":{"bg":"#111615","sidebar":"#151C18","panel":"#1B231E","panelAlt":"#232D26","field":"#141B17","line":"#354239","ink":"#F1F5EF","muted":"#A8B6AC","subtle":"#829488","accent":"#C6F27D","accentLow":"#2A3B26","onAccent":"#172412","amber":"#F2C77D","red":"#F2A096","redLow":"#3A2624","cyan":"#A9D1CF"},"page":"0:1","fonts":["Noto Sans SC","Noto Serif SC","Geist Mono"],"discovery":{"codeConnect":"none","existingScreens":"empty","libraries":"community SDS inspected; local components required for Chinese typography and custom dark theme","style":"custom Chinese desktop interface"},"counts":{"screens":9,"variables":29,"components":32}};
const page=await figma.getNodeByIdAsync(L.page); await figma.setCurrentPageAsync(page);
await Promise.all([{family:"Noto Sans SC",style:"Regular"},{family:"Noto Sans SC",style:"Medium"},{family:"Noto Sans SC",style:"Bold"},{family:"Noto Serif SC",style:"Medium"},{family:"Geist Mono",style:"Regular"}].map(f=>figma.loadFontAsync(f)));
const created=[], mutated=[], links=[];
const V=Object.fromEntries(await Promise.all(Object.entries(L.variables).map(async([k,id])=>[k,await figma.variables.getVariableByIdAsync(id)])));
const compIDs=[...Object.values(L.components.button),...Object.values(L.components.badge),...Object.values(L.components.icons),...Object.values(L.components.nav),L.components.input,L.components.art];
const C=Object.fromEntries(await Promise.all(compIDs.map(async id=>[id,await figma.getNodeByIdAsync(id)])));
const remember=n=>(created.push(n.id),n);
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const paint=n=>figma.variables.setBoundVariableForPaint({type:"SOLID",color:rgb(L.palette[n])},"color",V["color/"+n]);
function fill(n,c){n.fills=c?[paint(c)]:[];}
function rad(n,r=12){n.setBoundVariable("cornerRadius",V["radius/"+r]);}
function gap(n,g){if(V["space/"+g])n.setBoundVariable("itemSpacing",V["space/"+g]);else n.itemSpacing=g;}
function pad(n,x,y=x){for(const k of ["paddingLeft","paddingRight"]){if(V["space/"+x])n.setBoundVariable(k,V["space/"+x]);else n[k]=x;}for(const k of ["paddingTop","paddingBottom"]){if(V["space/"+y])n.setBoundVariable(k,V["space/"+y]);else n[k]=y;}}
function A(parent,name,dir,w,h=null,bg=null,padding=0,spacing=0){const f=remember(figma.createAutoLayout(dir));f.name=name;fill(f,bg);f.resize(w,h||10);f.primaryAxisSizingMode=dir==="HORIZONTAL"?"FIXED":h?"FIXED":"AUTO";f.counterAxisSizingMode=dir==="HORIZONTAL"&&!h?"AUTO":"FIXED";if(parent)parent.appendChild(f);if(padding)pad(f,padding);gap(f,spacing);f.clipsContent=false;return f;}
function T(parent,label,w,style="正文",color="ink"){w=Number(w);const t=remember(figma.createText());t.name=label.split("\n")[0].slice(0,32);t.fontName={family:"Noto Sans SC",style:style==="标题"?"Bold":["区块","小标题","标签"].includes(style)?"Medium":"Regular"};t.textStyleId=L.styles[style];t.characters=label;t.fills=[paint(color)];t.resize(w,24);t.textAutoResize="HEIGHT";t.characters=label;parent.appendChild(t);return t;}
function customText(parent,label,w,size=40,color="ink",family="Noto Sans SC",weight="Bold"){const t=remember(figma.createText());t.name=label.slice(0,32);t.fontName={family,style:weight};t.fontSize=size;t.lineHeight={unit:"PIXELS",value:Math.ceil(size*1.35)};t.characters=label;t.fills=[paint(color)];t.resize(w,24);t.textAutoResize="HEIGHT";t.characters=label;parent.appendChild(t);return t;}
function line(parent,w){const r=remember(figma.createRectangle());r.name="分隔线";r.resize(w,1);r.fills=[paint("line")];parent.appendChild(r);return r;}
function icon(parent,key,size=20){const i=remember(C[L.components.icons[key]].createInstance());parent.appendChild(i);i.rescale(size/24);return i;}
function button(parent,label,type="次要",width=144,height=44,dest){const i=remember(C[L.components.button[type]].createInstance());parent.appendChild(i);i.setProperties({[L.props.button]:label});i.resize(width,height);i.name="按钮 / "+label;if(dest)links.push({id:i.id,dest});return i;}
function badge(parent,label,state="中性"){const i=remember(C[L.components.badge[state]].createInstance());parent.appendChild(i);i.setProperties({[L.props.badge]:label});i.name="状态 / "+label;return i;}
function input(parent,value,w,h=44){const i=remember(C[L.components.input].createInstance());parent.appendChild(i);i.setProperties({[L.props.input]:value});i.resize(w,h);i.counterAxisAlignItems=h>44?"MIN":"CENTER";i.name="输入 / "+value.slice(0,20);return i;}
function card(parent,name,w,h=null,bg="panel",padding=24,spacing=16){const f=A(parent,name,"VERTICAL",w,h,bg,padding,spacing);rad(f,16);f.strokes=[paint("line")];f.strokeWeight=1;return f;}
function row(parent,name,w,h=null,spacing=12){const f=A(parent,name,"HORIZONTAL",w,h,null,0,spacing);f.counterAxisAlignItems="CENTER";return f;}
function col(parent,name,w,spacing=8){return A(parent,name,"VERTICAL",w,null,null,0,spacing);}
function spacer(parent,w,h=1,grow=false){const f=A(parent,"弹性间距","VERTICAL",w,h);if(grow)f.layoutSizingVertical="FILL";return f;}
function headingRow(parent,title,width,side="",style="小标题"){const f=row(parent,title,width,30);T(f,title,side?width-150:width,style);if(side)T(f,side,138,"辅助","muted");return f;}
function art(parent,size=120){const i=remember(C[L.components.art].createInstance());parent.appendChild(i);i.rescale(size/240);return i;}
function waveform(parent,w=300,h=48,green=true){const f=remember(figma.createNodeFromSvg('<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg">'+Array.from({length:64},(_,i)=>{const bh=8+Math.abs(Math.sin(i*0.81)*Math.cos(i*0.23))* (h-10);return '<rect x="'+(i*w/64)+'" y="'+((h-bh)/2)+'" width="'+(w/90)+'" height="'+bh+'" rx="1.5" fill="'+(green&&i<31?L.palette.accent:L.palette.line)+'"/>';}).join('')+'</svg>'));f.name="波形 / 试听预览";parent.appendChild(f);return f;}
function nav(parent,label,key,selected=false,dest){const i=remember(C[L.components.nav[selected?"选中":"默认"]].createInstance());parent.appendChild(i);i.setProperties({[L.props.nav]:label,[L.props.navIcon]:L.components.icons[key]});i.resize(176,46);i.name="导航 / "+label;if(dest)links.push({id:i.id,dest});return i;}
function footer(root){const f=A(root,"全局播放器","HORIZONTAL",1440,88,"panel",24,24);f.counterAxisAlignItems="CENTER";f.strokes=[paint("line")];f.strokeTopWeight=1;art(f,48);const info=col(f,"当前播放",212,2);T(info,"晨光",212,"标签");T(info,"华语流行 · 轻快女声",212,"辅助","muted");icon(f,"previous",20);button(f,"播放","主要",64,40,"detail");icon(f,"next",20);T(f,"00:12",44,"辅助","muted");waveform(f,420,34);T(f,"00:28",44,"辅助","muted");icon(f,"volume",20);const vl=row(f,"音量",88,16,0);const bar=remember(figma.createRectangle());bar.resize(88,3);fill(bar,"line");rad(bar,6);vl.appendChild(bar);button(f,"播放队列","文字",100,36,"library");return f;}
function shell(root,title,subtitle,active,crumb){root.itemSpacing=0;const body=A(root,"工作区","HORIZONTAL",1440,936);const side=A(body,"主导航","VERTICAL",224,936,"sidebar",24,24);
 const brand=row(side,"品牌",176,44,10);icon(brand,"music",30);customText(brand,"听见",124,28,"ink","Noto Sans SC","Bold");T(side,"本地音乐工作台",176,"辅助","muted");
 const ns=col(side,"导航",176,8);nav(ns,"开始创作","music",active==="create","create");nav(ns,"我的作品","library",active==="library","library");nav(ns,"我的项目","folder",active==="project","project");nav(ns,"任务队列","queue",active==="queue","queue");
 line(side,176);T(side,"更多创作方式",176,"辅助","subtle");
 const extras=col(side,"待启用功能",176,12);for(const label of ["音频改编","哼唱成歌"]){const r=row(extras,label,176,24,8);icon(r,"lock",16);T(r,label,84,"正文","muted");T(r,"未启用",60,"辅助","subtle");}
 spacer(side,176,1,true);nav(side,"设置","settings",active==="settings","settings");
 const state=card(side,"本机状态",176,92,"panel",12,4);T(state,title.includes("正在")?"●  本机运行 · 生成中":"●  本机运行 · 已就绪",150,"辅助","accent");T(state,"Apple M5 · 16 GB",150,"辅助","muted");T(state,"作品保存在这台电脑",150,"辅助","subtle");
 const main=A(body,"页面内容","VERTICAL",1216,936,null,32,24);
 const top=row(main,"页头",1152,24,12);T(top,crumb||"工作台  /  "+title,850,"辅助","muted");T(top,"YuE2  本地引擎",150,"辅助","muted");badge(top,title.includes("正在")?"生成中":"已就绪",title.includes("正在")?"处理中":"完成");
 const hero=col(main,"标题区",1152,4);customText(hero,title,1152,32);T(hero,subtitle,1152,"正文","muted");
 const content=A(main,"主体内容","VERTICAL",1152,null,null,0,24);footer(root);return {main,content,hero,side};}
function tagRow(parent,tags,w){const r=row(parent,"风格标签",w,28,8);for(const tag of tags)badge(r,tag);return r;}
function form(parent){const c=card(parent,"创作表单",744,null,"panel",24,12);
 const n=col(c,"作品名称",696,6);const nr=row(n,"名称标签",696,22);T(nr,"作品名称",576,"标签");T(nr,"选填",108,"辅助","muted");input(n,"晨光",696,44);
 const st=col(c,"风格",696,8);headingRow(st,"音乐风格",696,"必填");input(st,"温暖的华语流行，清澈女声，木吉他与钢琴，轻快而治愈。",696,64);tagRow(st,["华语流行","温柔民谣","轻快女声","木吉他"],696);
 const ly=col(c,"歌词编辑器",696,8);headingRow(ly,"歌词",696,"必填 · 支持段落标记");
 const tags=row(ly,"插入段落",696,28,8);for(const t of ["＋ 主歌","＋ 副歌","＋ 间奏","＋ 结尾"])button(tags,t,"次要",88,28);
 input(ly,"[Verse]\n晨光轻轻落在窗前\n微风吹过安静街边\n把小小心愿唱给蓝天\n让新的故事从今天开篇",696,144);
 const advanced=row(c,"高级设置入口",696,36);icon(advanced,"settings",18);T(advanced,"高级设置",128,"标签");T(advanced,"完整编曲 · 随机变化 · 1 个版本",388,"辅助","muted");const ab=button(advanced,"展开","文字",106,32);links.push({id:ab.id,dest:"advanced",overlay:true});
 return c;}
function audit(root){const ns=root.findAll(()=>true);const counts={};for(const n of ns)counts[n.type]=(counts[n.type]||0)+1;const images=ns.filter(n=>"fills"in n&&Array.isArray(n.fills)&&n.fills.some(f=>f.type==="IMAGE")).map(n=>({id:n.id,name:n.name,type:n.type,width:n.width,height:n.height}));return {id:root.id,name:root.name,width:root.width,height:root.height,descendants:ns.length,counts,images,textFonts:[...new Set(ns.filter(n=>n.type==="TEXT").flatMap(n=>n.getStyledTextSegments(["fontName"]).map(s=>s.fontName.family)))]};}

const PIDS={"可估算":"27:959","不定进度":"27:960","已完成":"27:961","正在取消":"27:962"};
const PC=Object.fromEntries(await Promise.all(Object.entries(PIDS).map(async([k,id])=>[k,await figma.getNodeByIdAsync(id)])));
const deleted=[];
async function editText(id,text){const n=await figma.getNodeByIdAsync(id);if(!n||n.type!=="TEXT")throw new Error("Text missing "+id);await Promise.all(n.getStyledTextSegments(["fontName"]).map(s=>figma.loadFontAsync(s.fontName)));n.characters=text;mutated.push(id);return n;}
async function editInstance(id,prop,text){const n=await figma.getNodeByIdAsync(id);await Promise.all(n.findAllWithCriteria({types:["TEXT"]}).flatMap(t=>t.getStyledTextSegments(["fontName"]).map(s=>figma.loadFontAsync(s.fontName))));n.setProperties({[prop]:text});n.name="按钮 / "+text;mutated.push(n.id);return n;}
function clear(n){for(const c of [...n.children]){deleted.push(c.id,...("findAll"in c?c.findAll(()=>true).map(x=>x.id):[]));c.remove();}mutated.push(n.id);}
function progressBar(parent,w,state="可估算"){const n=remember(PC[state].createInstance());parent.appendChild(n);n.resize(w,8);n.name="生成进度 / "+state;for(const ch of n.children){if(ch.type==="RECTANGLE"){ch.resize(ch.name==="进度填充"?(state==="已完成"?w:state==="不定进度"?w/3:w*.75):w*.3,8);mutated.push(ch.id);}}return n;}
function click(n,dest,overlay=false){n.reactions=[{trigger:{type:"ON_CLICK"},actions:[{type:"NODE",destinationId:dest,navigation:overlay?"OVERLAY":"NAVIGATE",transition:{type:"DISSOLVE",easing:{type:"EASE_OUT"},duration:.18},resetScrollPosition:true}]}];mutated.push(n.id);}
function close(n){n.reactions=[{trigger:{type:"ON_CLICK"},actions:[{type:"CLOSE"}]}];mutated.push(n.id);}
function spread(n){n.primaryAxisAlignItems="SPACE_BETWEEN";gap(n,12);return n;}
function progressMeta(parent,w,stacked=false){const r=row(parent,"时间信息",w,stacked?48:24,12);const c1=col(r,"已用时间",stacked?(w-12)/2:240,2);T(c1,stacked?"已用时间":"已用  00:43",c1.width,"辅助","muted");if(stacked)T(c1,"00:43",c1.width,"小标题");const c2=col(r,"剩余时间",stacked?(w-12)/2:w-252,2);T(c2,stacked?"预计剩余":"预计剩余  约 14 秒",c2.width,"辅助","muted");if(stacked)T(c2,"约 14 秒",c2.width,"小标题");return r;}

const overlays={};
const details=card(page,"22 · 当前任务 / 进度详情",640,null,"panel",32,16);details.x=5400;details.y=6300;overlays.details=details.id;
const dh=spread(row(details,"详情标题",576,36));T(dh,"生成进度详情",456,"区块");const dc=button(dh,"关闭","文字",96,36);close(dc);
T(details,"晨光 · 版本 2",576,"小标题");T(details,"整体进度 75%（估算） · 已用 00:43",576,"辅助","muted");progressBar(details,576);
const stageList=col(details,"实际阶段记录",576,8);
for(const s of [["✓","准备模型","已完成"],["✓","编写乐谱","已完成"],["✓","生成音乐","已完成"],["●","合成音频","2 / 8 步"],["—","处理音频","等待"],["—","保存作品","等待"]]){
 const rr=row(stageList,s[1],576,36,12);T(rr,s[0],24,"正文",s[0]==="●"?"accent":"muted");T(rr,s[1],336,"正文",s[0]==="—"?"muted":"ink");T(rr,s[2],192,"辅助",s[0]==="●"?"accent":"muted");
}
line(details,576);T(details,"预计剩余约 14 秒，会随实际进度调整。\n阶段切换时可能再次准备模型；完成后自动保存作品。",576,"辅助","muted");
const cancelling=card(page,"23 · 当前任务 / 正在取消",520,null,"panel",32,16);cancelling.x=6100;cancelling.y=6300;overlays.cancelling=cancelling.id;
badge(cancelling,"正在取消","处理中");T(cancelling,"正在停止本次生成",456,"区块");T(cancelling,"晨光 · 版本 2",456,"标签");progressBar(cancelling,456,"正在取消");
T(cancelling,"取消请求已发送，当前步骤结束后停止。\n你可以切换页面，等待任务状态更新。",456,"正文","muted");
const cr=spread(row(cancelling,"取消状态操作",456,44));button(cr,"正在取消…","禁用",216,44);const cc=button(cr,"返回任务队列","次要",216,44);close(cc);

const content=await figma.getNodeByIdAsync("6:682");clear(content);gap(content,20);
const stats=row(content,"任务状态汇总",1152,76,24);
for(const s of [["1","正在生成","accent"],["2","排队等待","amber"],["3","已完成","ink"]]){
 const st=card(stats,"汇总 / "+s[1],368,76,"panel",16,0);st.layoutMode="HORIZONTAL";st.counterAxisAlignItems="CENTER";gap(st,20);
 customText(st,s[0],48,28,s[2],"Geist Mono","Regular");T(st,s[1],268,"正文","muted");
}
const task=card(content,"当前任务 / 可估算进度",1152,null,"panel",24,16);
const head=spread(row(task,"任务名称与操作",1104,36));T(head,"晨光 · 版本 2",700,"小标题");badge(head,"正在生成","处理中");const cancel=button(head,"取消本次生成","文字",168,36);click(cancel,cancelling.id,true);
const phase=spread(row(task,"当前阶段与整体进度",1104,60));
const phaseInfo=col(phase,"当前阶段",840,4);customText(phaseInfo,"正在合成音频",840,22);T(phaseInfo,"当前步骤  2 / 8",840,"辅助","muted");
const percent=col(phase,"整体进度",160,2);const pt=customText(percent,"75%",160,32,"accent","Geist Mono","Regular");pt.textAlignHorizontal="RIGHT";const pl=T(percent,"整体进度（估算）",160,"辅助","muted");pl.textAlignHorizontal="RIGHT";
progressBar(task,1104);progressMeta(task,1104);
line(task,1104);
const bottom=spread(row(task,"后台生成与详情",1104,36));T(bottom,"切换页面不影响生成，完成后自动保存到「我的作品」。",904,"辅助","muted");const det=button(bottom,"查看进度详情","次要",168,36);click(det,details.id,true);
const waiting=card(content,"排队等待",1152,null,"panel",24,12);
const wh=spread(row(waiting,"等待队列标题",1104,28));T(wh,"排队等待",820,"小标题");T(wh,"按提交顺序生成",220,"辅助","muted");
for(const [rank,title] of [[1,"夜航 · 版本 1"],[2,"街角蓝调 · 版本 2"]]){
 const wr=spread(row(waiting,"等待 / "+title,1104,48));T(wr,"0"+rank,36,"辅助","subtle");
 const ti=col(wr,"等待任务信息",720,2);T(ti,title,720,"标签");T(ti,"排队第 "+rank+" 位",720,"辅助","muted");
 badge(wr,"等待中","中性");const remove=button(wr,"移出队列","文字",132,36);
}
const recent=card(content,"最近完成",1152,68,"panelAlt",16,0);recent.layoutMode="HORIZONTAL";recent.counterAxisAlignItems="CENTER";spread(recent);
const ri=col(recent,"最近完成作品",760,2);T(ri,"最近完成  ·  晨光 · 版本 1",760,"标签");T(ri,"已保存  ·  00:28",760,"辅助","muted");const listen=button(recent,"试听作品","主要",136,36);click(listen,"2:59");const all=button(recent,"全部已完成","文字",160,36);click(all,"2:58");

const right=await figma.getNodeByIdAsync("5:333");clear(right);right.primaryAxisSizingMode="AUTO";gap(right,16);
const rh=spread(row(right,"当前任务名称",336,36));T(rh,"晨光 · 版本 2",220,"小标题");badge(rh,"生成中","处理中");
const rph=col(right,"当前阶段",336,4);customText(rph,"正在合成音频",336,24);T(rph,"当前步骤  2 / 8",336,"辅助","muted");
const rp=spread(row(right,"整体估算",336,42));T(rp,"整体进度（估算）",200,"辅助","muted");customText(rp,"75%",100,28,"accent","Geist Mono","Regular");
progressBar(right,336);progressMeta(right,336,true);
T(right,"剩余时间会随实际进度调整。",336,"辅助","muted");line(right,336);
const rd=button(right,"查看进度详情","次要",336,40);click(rd,details.id,true);
T(right,"切换页面不影响生成。\n完成后自动保存到「我的作品」。",336,"正文","muted");
const rq=button(right,"查看任务队列","次要",336,40);click(rq,"2:61");
const rc=button(right,"取消本次生成","文字",336,36);click(rc,cancelling.id,true);

await editText("5:182","音乐正在生成");
await editText("5:183","当前任务在右侧更新，你也可以继续准备下一首。");
const lf=await figma.getNodeByIdAsync("5:281");const draftHead=col(lf,"下一首草稿说明",696,4);T(draftHead,"继续创作下一首",696,"小标题");T(draftHead,"修改这里不会改变当前任务。",696,"辅助","muted");lf.insertChild(0,draftHead);mutated.push(lf.id);
await editInstance("5:286",L.props.input,"夜航");
await editInstance("5:292",L.props.input,"舒缓的都市民谣，温暖男声，木吉他与轻柔鼓点，安静而松弛。");
await editInstance("5:316",L.props.input,"[Verse]\n霓虹在窗外慢慢退后\n晚风陪着我穿过路口\n把今天的心事轻轻放下\n沿着星光往家的方向走");
await editText("5:329","准备好后加入队列");
await editText("5:330","按顺序生成，不影响当前任务");
const root=await figma.getNodeByIdAsync("2:57");root.reactions=[];mutated.push(root.id);
await editText("6:681","查看实时进度，按提交顺序生成。");
await editInstance("5:946",L.props.button,"按原参数再生成");
await editInstance("5:950",L.props.button,"修改参数后创作");

const footers=page.findAll(n=>n.type==="FRAME"&&n.name==="全局播放器");
for(const f of footers){const info=f.children.find(n=>n.type==="FRAME"&&n.name==="当前播放");if(info){const ts=info.children.filter(n=>n.type==="TEXT");if(ts[0])await editText(ts[0].id,"试听：晨光 · 版本 1");if(ts[1])await editText(ts[1].id,"已完成作品 · 不影响生成");}}
await editText("7:578","实时进度与预计剩余时间");
await editText("7:606","实时进度 · 依次生成 · 取消任务");
await editText("7:667","• 取消生成：先显示「正在取消」，实际停止后才标记「已取消」。排队任务可直接移出。\n• 删除作品：二次确认，并说明会同时移除该作品的音频与生成文件。\n• 生成反馈：显示进度条、当前步骤与已用时间。整体百分比为估算；未知总量使用流动进度，预计时间注明「约」。\n• 再次生成：创建新作品，原作品保留。底部播放器只播放已完成的作品。");
const overviewBadge=await figma.getNodeByIdAsync("7:566");if(overviewBadge.type==="INSTANCE")await editInstance("7:566",L.props.badge,"v1.2");
page.name="01 / 听见 · 中文工作台（当前）";mutated.push(page.id);
return {createdNodeIds:created,mutatedNodeIds:[...new Set(mutated)],deletedNodeIds:deleted,overlays,queueTask:task.id,queueContent:{w:content.width,h:content.height},right:{w:right.width,h:right.height},draft:{w:lf.width,h:lf.height},updatedFooters:footers.length,audit:[audit(await figma.getNodeByIdAsync("2:61")),audit(root)]};
