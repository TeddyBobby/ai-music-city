
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
function A(parent,name,dir,w,h=null,bg=null,padding=0,spacing=0){const f=remember(figma.createAutoLayout(dir));f.name=name;fill(f,bg);f.resize(w,h||10);f.primaryAxisSizingMode=h?"FIXED":"AUTO";f.counterAxisSizingMode="FIXED";if(parent)parent.appendChild(f);if(padding)pad(f,padding);gap(f,spacing);f.clipsContent=false;return f;}
function T(parent,label,w,style="正文",color="ink"){const t=remember(figma.createText());t.name=label.split("\n")[0].slice(0,32);t.fontName={family:"Noto Sans SC",style:style==="标题"?"Bold":["区块","小标题","标签"].includes(style)?"Medium":"Regular"};t.textStyleId=L.styles[style];t.characters=label;t.fills=[paint(color)];t.resize(w,24);t.textAutoResize="HEIGHT";t.characters=label;parent.appendChild(t);return t;}
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

const affected=[];
{
 const root=await figma.getNodeByIdAsync(L.screens.project);mutated.push(root.id);affected.push(root);const s=shell(root,"我的项目","把零散的灵感，整理成一张属于你的专辑。","project");
 const head=card(s.content,"项目概览",1152,null,"panel",24,0);head.layoutMode="HORIZONTAL";head.counterAxisAlignItems="CENTER";gap(head,24);art(head,80);
 const meta=col(head,"当前项目",620,4);T(meta,"晨光集  ▾",620,"区块");T(meta,"给平凡日子写一张小专辑。  ·  3 首曲目，2 首已定稿",620,"正文","muted");button(head,"＋ 新建项目","次要",164,44);button(head,"导出专辑  ▾","主要",192,44);
 const cols=row(s.content,"曲目与版本",1152,null,24);cols.counterAxisAlignItems="MIN";
 const tracks=card(cols,"曲目列表",296,null,"sidebar",16,16);headingRow(tracks,"曲目",264,"拖动可排序");
 for(const [num,name,detail,active] of [["01","晨光","3 个版本 · 已定稿",true],["02","夜航","2 个版本 · 已定稿",false],["03","街角蓝调","1 个版本 · 待选择",false]]){const tr=card(tracks,"曲目 / "+name,264,null,active?"accentLow":"panel",16,8);const r=row(tr,"名称",232,26,8);T(r,num,28,"辅助","muted");T(r,name,196,"标签",active?"accent":"ink");T(tr,detail,232,"辅助","muted");}
 button(tracks,"＋ 添加曲目","次要",264,40);T(tracks,"每首曲目选择一个定稿，\n用于播放和导出整张专辑。",264,"辅助","muted");
 const versions=card(cols,"候选版本",832,null,"panel",24,16);const vh=row(versions,"版本标题",784,36);T(vh,"01  晨光",512,"区块");T(vh,"3 个候选版本",260,"辅助","muted");T(versions,"试听、比较，再留下最打动你的一个。",784,"正文","muted");
 const takes=[["版本 1","00:28 · 快速模式","人声清晰，木吉他的层次很好。","★★★★★",true],["版本 2","00:31 · 快速模式","节奏更轻快，结尾可以再自然一点。","★★★★☆",false],["版本 3","00:26 · 快速模式","留作备选。","★★★☆☆",false]];
 for(const [name,info,note,rating,chosen] of takes){const take=card(versions,"候选 / "+name,784,null,chosen?"accentLow":"field",16,10);const rr=row(take,"版本操作",752,32,12);T(rr,name,160,"标签");T(rr,info,316,"辅助","muted");if(chosen)badge(rr,"已选为定稿","完成");else button(rr,"设为定稿","次要",116,32);button(rr,"试听","文字",100,32,"detail");const rr2=row(take,"评价",752,24,16);T(rr2,rating,144,"标签","amber");T(rr2,note,592,"辅助","muted");}
 const va=row(versions,"新增候选",784,40);button(va,"从作品库加入","次要",200,40,"library");button(va,"为这首曲目再创作","文字",236,40,"create");
}
{
 const root=await figma.getNodeByIdAsync(L.screens.queue);mutated.push(root.id);affected.push(root);const s=shell(root,"任务队列","按顺序生成，所有进度都在这里。","queue");
 const summary=row(s.content,"任务状态汇总",1152,null,24);
 for(const [n,label,c] of [["1","正在生成","accent"],["2","排队等待","amber"],["3","已完成","ink"]]){const stat=card(summary,label,368,92,"panel",16,0);stat.layoutMode="HORIZONTAL";stat.counterAxisAlignItems="CENTER";gap(stat,16);customText(stat,n,52,32,c,"Geist Mono","Regular");T(stat,label,260,"正文","muted");}
 const running=card(s.content,"正在生成",1152,null,"panel",24,20);const hdr=row(running,"任务标题",1104,36);T(hdr,"晨光 · 版本 2",780,"区块");badge(hdr,"生成音乐中","处理中");button(hdr,"取消生成","文字",168,36);
 const stages=row(running,"阶段进度",1104,64,16);for(const [num,title,state] of [["✓","准备模型","done"],["✓","编写乐谱","done"],["3","生成音乐","running"],["4","合成音频","waiting"],["5","保存作品","waiting"]]){const step=col(stages,title,208,6);T(step,num,208,"标签",state==="running"?"accent":"muted");T(step,title,208,"正文",state==="running"?"ink":"muted");}
 const elapsed=row(running,"实时信息",1104,28);T(elapsed,"已用 00:43",220,"标签","accent");T(elapsed,"当前阶段持续更新，完成后自动保存。",872,"正文","muted");line(running,1104);T(running,"你可以离开这个页面，任务仍会继续。",1104,"辅助","muted");
 const wait=card(s.content,"等待中的任务",1152,null,"sidebar",24,16);headingRow(wait,"排队等待",1104,"依次生成");
 for(const [no,name,desc] of [["01","夜航 · 版本 1","前方还有 1 个任务"],["02","街角蓝调 · 版本 2","前方还有 2 个任务"]]){const rr=row(wait,name,1104,64,16);T(rr,no,40,"辅助","subtle");const cc=col(rr,"任务名称",792,2);T(cc,name,792,"标签");T(cc,desc,792,"辅助","muted");badge(rr,"排队中");button(rr,"取消","文字",128,36);}
 T(s.content,"已完成 3  ·  失败 1  ·  已取消 0     查看历史记录 →",1152,"辅助","muted");
}
{
 const root=await figma.getNodeByIdAsync(L.screens.settings);mutated.push(root.id);affected.push(root);const s=shell(root,"设置","适合这台 Mac 的配置，已经为你准备好。","settings");
 const cols=row(s.content,"设置内容",1152,null,24);cols.counterAxisAlignItems="MIN";
 const left=col(cols,"运行设置",728,24);const rec=card(left,"推荐配置",728,null,"accentLow",24,12);const rh=row(rec,"推荐标题",680,30);T(rh,"本机推荐",560,"区块");badge(rh,"已应用","完成");T(rec,"Apple M5  ·  16 GB 统一内存",680,"正文","muted");T(rec,"快速生成 + 低内存模式，优先保证稳定运行。",680,"正文","ink");
 const setting=card(left,"基础设置",728,null,"panel",24,20);
 const presets=row(setting,"默认模式",680,48,24);const a=col(presets,"默认模式说明",390,2);T(a,"默认生成模式",390,"标签");T(a,"快速模式适合日常创作",390,"辅助","muted");button(presets,"快速 · 推荐  ▾","次要",266,44);
 line(setting,680);
 const mem=row(setting,"低内存模式",680,48,24);const b=col(mem,"内存说明",470,2);T(b,"低内存模式",470,"标签");T(b,"按阶段加载模型，减少内存占用",470,"辅助","muted");badge(mem,"已开启","完成");
 const budget=col(setting,"内存预算",680,8);const br=row(budget,"预算标签",680,30);T(br,"内存预算",500,"标签");T(br,"10 GiB",168,"标签","accent");
 const slider=row(budget,"预算滑块",680,12,0);const bar=remember(figma.createRectangle());slider.appendChild(bar);bar.resize(680,4);fill(bar,"line");rad(bar,6);const fillbar=remember(figma.createRectangle());slider.appendChild(fillbar);fillbar.layoutPositioning="ABSOLUTE";fillbar.x=0;fillbar.y=4;fillbar.resize(452,4);fill(fillbar,"accent");rad(fillbar,6);const knob=remember(figma.createEllipse());slider.appendChild(knob);knob.layoutPositioning="ABSOLUTE";knob.x=448;knob.y=-2;knob.resize(16,16);fill(knob,"accent");const labs=row(budget,"预算范围",680,22);T(labs,"6 GiB",500,"辅助","subtle");T(labs,"12 GiB",168,"辅助","subtle");
 T(budget,"为其他应用留出内存。更改会在下一次生成时生效。",680,"辅助","muted");line(setting,680);
 const theme=row(setting,"外观",680,44,24);T(theme,"界面外观",390,"标签");button(theme,"深色  ▾","次要",266,40);
 const power=row(setting,"电源",680,42,24);T(power,"仅在连接电源时生成",470,"标签");badge(power,"已关闭");
 const actions=row(left,"保存设置",728,44);T(actions,"运行配置将在下一个任务中应用。",500,"辅助","muted");button(actions,"保存设置","主要",216,44);
 const right=card(cols,"扩展能力",400,null,"sidebar",24,18);T(right,"扩展能力",352,"区块");T(right,"当前以歌词创作为主，以下能力按需配置。",352,"正文","muted");
 for(const [name,state,desc] of [["音频改编","未启用","上传音频后保留旋律再创作。\n需要额外的转谱模型。"],["哼唱成歌","未启用","围绕你哼唱的旋律创作。\n需要额外的转谱模型。"],["风格适配器","未安装","可读取本地 LoRA，扩展风格。"],["智能写词助手","已关闭","可选的外部服务，需单独配置。"]]){line(right,352);const r=row(right,name,352,30,8);T(r,name,242,"标签");badge(r,state,"未启用");T(right,desc,352,"辅助","muted");}
 line(right,352);T(right,"不会自动下载扩展模型。",352,"辅助","accent");
}
return {createdNodeIds:[...new Set([...created,...affected.flatMap(r=>r.findAll(()=>true).map(n=>n.id))])],mutatedNodeIds:mutated,links,audits:affected.map(audit)};
