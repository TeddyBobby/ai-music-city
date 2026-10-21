
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
function progressBar(parent,w,state="可估算"){const n=remember(PC[state].createInstance());parent.appendChild(n);n.resize(w,8);n.name="生成进度 / "+state;return n;}
function click(n,dest,overlay=false){n.reactions=[{trigger:{type:"ON_CLICK"},actions:[{type:"NODE",destinationId:dest,navigation:overlay?"OVERLAY":"NAVIGATE",transition:{type:"DISSOLVE",easing:{type:"EASE_OUT"},duration:.18},resetScrollPosition:true}]}];mutated.push(n.id);}
function close(n){n.reactions=[{trigger:{type:"ON_CLICK"},actions:[{type:"CLOSE"}]}];mutated.push(n.id);}
function spread(n){n.primaryAxisAlignItems="SPACE_BETWEEN";gap(n,12);return n;}
function progressMeta(parent,w,stacked=false){const r=row(parent,"时间信息",w,stacked?48:24,12);const c1=col(r,"已用时间",stacked?(w-12)/2:240,2);T(c1,stacked?"已用时间":"已用  00:43",c1.width,"辅助","muted");if(stacked)T(c1,"00:43",c1.width,"小标题");const c2=col(r,"剩余时间",stacked?(w-12)/2:w-252,2);T(c2,stacked?"预计剩余":"预计剩余  约 14 秒",c2.width,"辅助","muted");if(stacked)T(c2,"约 14 秒",c2.width,"小标题");return r;}

for(const [state,id] of Object.entries(PIDS)){
 const c=await figma.getNodeByIdAsync(id);c.layoutMode="NONE";c.resize(336,8);mutated.push(c.id);
 for(const ch of c.children){if(ch.type==="RECTANGLE"){ch.resize(ch.name==="进度填充"?(state==="已完成"?336:state==="不定进度"?112:252):100,8);ch.x=state==="不定进度"&&ch.name==="进度填充"?100:0;ch.y=0;ch.constraints={horizontal:"SCALE",vertical:"STRETCH"};mutated.push(ch.id);}}
}
for(const id of ["2:57","2:61"]){const root=await figma.getNodeByIdAsync(id);for(const t of root.findAllWithCriteria({types:["TEXT"]}).filter(n=>n.characters==="当前步骤  2 / 8"))await editText(t.id,"音频合成 · 第 2 / 8 步");}

await editInstance("5:286",L.props.input,"晚归");
await editText("7:640","本次生成已停止，歌词与参数保留。\n需要时，可以按相同设置重新创建。");
const states=await figma.getNodeByIdAsync("29:971");
const replacements={
 "当前步骤  2 / 8\n已用 00:43 · 预计剩余约 14 秒":"音频合成 · 第 2 / 8 步\n已用 00:43 · 预计剩余约 14 秒",
 "不显示虚假的 0% 或固定倒计时。\n流动进度表示任务仍在运行。":"正在编写旋律与伴奏。\n完成后会继续生成音乐。",
 "实际停止后显示「已取消」。\n输入内容保留，可重新创建。":"实际停止后显示「已取消」。\n本次歌词与参数保留。",
 "仅在服务返回完成后显示 100%。":"歌词与参数已保留，\n需要时可以继续创作新版本。"
};
for(const n of states.findAllWithCriteria({types:["TEXT"]})){if(replacements[n.characters])await editText(n.id,replacements[n.characters]);}
for(const n of states.findAll(n=>n.type==="INSTANCE"&&(n.name==="状态 / 有明确步骤"||n.name==="状态 / 暂时无法估算")))await editInstance(n.id,L.props.badge,"生成中");

const history=card(page,"25 · 历史任务 / 完成与失败",880,null,"panel",32,20);history.x=3800;history.y=6300;
const hh=spread(row(history,"历史任务标题",816,36));T(hh,"历史任务",660,"区块");const hc=button(hh,"关闭","文字",96,36);close(hc);
T(history,"已完成 3  ·  失败 1  ·  已取消 0",816,"正文","muted");
for(const [title,status,desc] of [["晨光 · 版本 1","已完成","00:28 · 已保存"],["远山 · 版本 1","已完成","00:32 · 已保存"],["玻璃海 · 版本 1","已完成","00:24 · 已保存"],["星河 · 版本 1","失败","内存不足 · 本次歌词与参数保留"]]){
 const item=card(history,"任务记录 / "+title,816,null,status==="失败"?"redLow":"field",16,12);
 const r=spread(row(item,"任务记录行",784,52));const t=col(r,"作品信息",516,4);T(t,title,516,"标签");T(t,desc,516,"辅助","muted");badge(r,status,status==="失败"?"错误":"完成");
 const btn=button(r,status==="失败"?"查看原因":"查看作品","次要",128,36);click(btn,status==="失败"?"2:63":"2:59");
}
T(history,"重新创建会新增任务，原有记录会保留。",816,"辅助","muted");
const histButton=await editInstance("28:1077",L.props.button,"历史任务");click(histButton,history.id,true);

const board=await figma.getNodeByIdAsync("29:971");
const knownTexts=board.findAllWithCriteria({types:["TEXT"]}).filter(t=>t.characters.includes("当前步骤 2 / 8"));
for(const n of knownTexts){await editText(n.id,n.characters.replace("当前步骤 2 / 8","音频合成第 2 / 8 步"));}
return {createdNodeIds:created,mutatedNodeIds:[...new Set(mutated)],history:history.id,barChecks:await Promise.all(["27:959","28:1035","28:1090","29:983","28:967"].map(async id=>{const n=await figma.getNodeByIdAsync(id);return {id,w:n.width,fill:n.children.find(c=>c.name==="进度填充").width,ratio:n.children.find(c=>c.name==="进度填充").width/n.width};})),historyAudit:audit(history)};
