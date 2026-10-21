
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

const affected=[],extras={};
{
 const root=await figma.getNodeByIdAsync(L.screens.overview);mutated.push(root.id);affected.push(root);pad(root,40);gap(root,24);
 const hr=row(root,"方案标识",1360,32);T(hr,"听见  /  中文本地音乐工作台",1040,"小标题","accent");badge(hr,"设计方案 v1.0");
 customText(root,"从一句歌词，到一首自己的歌。",1360,42);T(root,"围绕已部署的 YuE2 能力设计，让创作、试听、整理和导出形成一条清晰的路径。",1360,"正文","muted");
 const flow=row(root,"使用流程",1360,null,16);
 for(const [n,t,b] of [["01","写下想法","风格 + 歌词，快速开始"],["02","交给本机","按阶段显示进度，后台生成"],["03","听见作品","试听、下载，也可以再换一版"],["04","整理成专辑","比较候选，选定稿后导出"]]){const c=card(flow,t,328,140,"panel",24,8);T(c,n,280,"辅助","accent");T(c,t,280,"区块");T(c,b,280,"辅助","muted");}
 headingRow(root,"功能地图",1360,"已核对 19 个模块");
 const groups=[["创作","中文风格提示 · 段落歌词\n完整编曲 · 多个候选版本"],["我的作品","搜索 · 播放 · 重命名\nMP3 / FLAC / 完整素材导出"],["乐谱与版本","查看或编辑 ABC 乐谱\n整曲再生成 · 保留原版"],["项目","有序曲目 · 候选评分与备注\n选择定稿 · 专辑播放与导出"],["任务队列","依次生成 · 查看阶段\n取消任务 · 失败后重新创建"],["设置","适合本机的预设 · 内存预算\n本机状态 · 扩展能力说明"]];
 for(let r=0;r<2;r++){const rr=row(root,"能力模块 "+r,1360,null,20);for(const [title,body] of groups.slice(r*3,r*3+3)){const c=card(rr,title,440,134,"sidebar",20,8);T(c,title,400,"小标题");T(c,body,400,"正文","muted");}}
 const available=card(root,"本机能力边界",1360,null,"accentLow",20,8);const ar=row(available,"能力状态",1320,28);T(ar,"当前可用",140,"标签","accent");T(ar,"歌词创作与导出  ·  M5 / 16 GB  ·  快速 8-bit  ·  低内存模式",1168,"正文");T(available,"扩展待配置：音频改编、哼唱成歌、风格适配器和智能写词助手。设计中明确状态，不自动下载模型。",1320,"辅助","muted");
 const bottom=row(root,"审阅说明",1360,36);T(bottom,"本稿为界面设计与流程演示，未连接真实生成任务。除《晨光》的验收信息外，其余作品与队列为示例数据。",1120,"辅助","muted");button(bottom,"从创作开始演示  →","主要",228,40,"create");
}
{
 const root=await figma.getNodeByIdAsync(L.screens.states);mutated.push(root.id);affected.push(root);pad(root,40);gap(root,24);T(root,"关键状态与反馈","1360","标题");T(root,"保留用户输入，说清楚发生了什么，并给出下一步。",1360,"正文","muted");
 const data=[
 ["第一首歌，从这里开始","空白状态","写下歌词，或填入一段示例，\n开始你的第一次创作。","填入示例","中性","create"],
 ["已加入队列","排队中","前方还有 1 个任务。\n轮到时会自动开始，无需重复提交。","查看队列","处理中","queue"],
 ["生成已取消","已取消","本次生成已停止，输入内容保留。\n需要时，可以用相同设置重新创建。","重新创建","中性","create"],
 ["本次生成因内存不足而停止","内存不足","关闭占内存较多的应用后，\n可以保留原设置重试。","重新创建","错误","create"],
 ["尚未连接本机服务","未连接","双击「启动 YuE2.command」后，\n回到这里重新连接。","重试连接","未启用","create"],
 ["音频可能提前结束","部分截断","作品仍可试听。尝试缩短歌词，\n或调整创作方式后再生成。","试听作品","处理中","detail"]
 ];
 for(let r=0;r<2;r++){const rr=row(root,"状态行 "+r,1360,null,20);for(const [title,status,body,act,state,dest] of data.slice(r*3,r*3+3)){const c=card(rr,title,440,264,state==="错误"?"redLow":"panel",24,16);badge(c,status,state);T(c,title,392,"小标题");T(c,body,392,"正文","muted");button(c,act,state==="错误"?"次要":"主要",180,40,dest);}}
 const rules=card(root,"交互规则",1360,null,"sidebar",24,12);T(rules,"一致的交互规则",1312,"区块");T(rules,"• 取消运行中的任务：先显示「正在取消」，在安全节点停止后更新为「已取消」。\n• 删除作品：二次确认，并说明会同时移除该作品的音频与生成文件。\n• 生成进度：展示阶段和已用时间，不承诺精确完成百分比；只有阶段提供总量时显示阶段计数。\n• 修改乐谱或再次生成：创建新作品，原作品保留。",1312,"正文","muted");
}
{
 const board=await figma.getNodeByIdAsync(L.componentBoard);mutated.push(board.id);affected.push(board);
 const colors=row(board,"色彩",1376,null,16);for(const k of ["bg","panel","field","line","ink","muted","accent"]){const c=card(colors,k,182,100,"panel",12,8);const sw=remember(figma.createRectangle());sw.resize(158,30);fill(sw,k);rad(sw,6);c.appendChild(sw);T(c,k+"  "+L.palette[k],158,"辅助","muted");}
 T(board,"按钮与反馈","1376","区块");const bs=row(board,"按钮样式",1376,48,12);for(const [label,type] of [["开始生成","主要"],["再做一版","次要"],["查看详情","文字"],["删除作品","危险"],["暂不可用","禁用"],["生成中…","生成中"]])button(bs,label,type,172,44);
 const badges=row(board,"状态标签",1376,36,12);for(const [label,state] of [["已完成","完成"],["生成中","处理中"],["排队中","中性"],["未启用","未启用"],["内存不足","错误"]])badge(badges,label,state);
 const comps=row(board,"表单与导航",1376,null,24);const cf=card(comps,"表单控件",800,null,"panel",24,16);T(cf,"中文输入","752","标签");input(cf,"温暖的华语流行，清澈女声，木吉他与钢琴。",752);input(cf,"[Verse]\n晨光轻轻落在窗前\n微风吹过安静街边",752,100);const navs=card(comps,"导航组件",552,null,"panel",24,16);nav(navs,"开始创作","music",true,"create");nav(navs,"我的作品","library",false,"library");T(navs,"选中态由颜色与背景共同区分",504,"辅助","muted");
 const typ=card(board,"文字规范",1376,null,"sidebar",24,12);T(typ,"中文字体：Noto Sans SC","1328","区块");T(typ,"页面标题 32 / 44   ·   区块标题 20 / 30   ·   正文 14 / 24   ·   辅助信息 12 / 20",1328,"正文","muted");T(typ,"共享语义颜色、间距和圆角变量；表单、按钮、导航、状态与封面均为可复用组件。",1328,"正文","muted");
}
{
 const root=A(page,"10 · 高级创作设置","VERTICAL",640,800,"panel",32,20);root.x=5000;root.y=1400;rad(root,24);root.clipsContent=true;affected.push(root);extras.advanced=root.id;
 const hdr=row(root,"高级设置标题",576,36);T(hdr,"高级创作设置",500,"区块");const close=button(hdr,"关闭","文字",64,32);links.push({id:close.id,close:true});
 T(root,"默认配置适合当前电脑；只在需要时调整。",576,"正文","muted");
 const mode=col(root,"创作方式",576,10);T(mode,"创作方式",576,"标签");const mr=row(mode,"规划方式",576,40,8);button(mr,"完整编曲","主要",184,40);button(mr,"仅规划旋律","次要",184,40);button(mr,"不使用乐谱","次要",192,40);T(mode,"完整编曲会先生成乐谱，再生成音乐。",576,"辅助","muted");
 line(root,576);
 const vers=row(root,"版本数量",576,44);T(vers,"生成版本数量",344,"标签");button(vers,"1 个版本  ▾","次要",220,40);T(root,"最多 16 个版本，按顺序生成。建议本机每次生成 1 个。",576,"辅助","muted");
 const sd=row(root,"随机种子",576,44);T(sd,"变化方式",344,"标签");button(sd,"每次随机  ▾","次要",220,40);T(root,"固定随机种子可复用同一组创作条件。",576,"辅助","muted");
 line(root,576);
 const pr=row(root,"生成方案",576,44);T(pr,"生成方案",344,"标签");button(pr,"快速 · 本机推荐  ▾","次要",220,40);T(root,"8-bit 精度 · 8 步合成。自定义模式可进一步调整。",576,"辅助","muted");
 const cfg=row(root,"引导强度",576,44);T(cfg,"引导强度",344,"标签");button(cfg,"模型默认  ▾","次要",220,40);
 button(root,"提供 ABC 乐谱  ＋","文字",576,36);
 const actions=row(root,"应用操作",576,44,16);T(actions,"仅影响下一次提交的任务",340,"辅助","muted");const apply=button(actions,"应用设置","主要",220,44);links.push({id:apply.id,close:true});
}
{
 const root=A(page,"11 · 乐谱编辑与再生成","VERTICAL",1000,840,"panel",32,20);root.x=5800;root.y=1400;rad(root,24);root.clipsContent=true;affected.push(root);extras.score=root.id;
 const hdr=row(root,"乐谱编辑标题",936,36);T(hdr,"乐谱与再生成",828,"区块");const close=button(hdr,"关闭","文字",96,32);links.push({id:close.id,close:true});
 T(root,"晨光 · 编辑乐谱后，生成一个新版本。原作品会保留。",936,"正文","muted");
 const tabs=row(root,"乐谱视图",936,40);button(tabs,"ABC 代码","主要",144,40);button(tabs,"乐谱预览","次要",144,40);button(tabs,"播放乐谱","文字",144,40);
 const editor=card(root,"ABC 乐谱编辑器",936,342,"field",24,12);const content="X:1\nT:晨光\nM:4/4\nL:1/16\nQ:1/4=107\nK:F\n% verse\nV: Vocal\n\"F\"c2a4c2\"Am7\"c4c2A2|\"Bb\"d6c2-\"C7\"c2z6|\n\"Dm7\"a4f4\"C\"g4e4|\"Bb\"f2e2d2c2-\"F/A\"c2z4c2|";customText(editor,content,888,16,"muted","Noto Sans SC","Regular");
 const style=col(root,"可选风格修改",936,8);T(style,"音乐风格（可选修改）",936,"标签");input(style,"温暖的华语流行，清澈女声，木吉他与钢琴。",936,44);
 const params=row(root,"再生成参数",936,44);T(params,"快速模式  ·  固定随机种子 20261021",620,"正文","muted");button(params,"调整参数","文字",304,40);
 const actions=row(root,"乐谱操作",936,48);T(actions,"重新生成整首音乐，不会覆盖原作品。",620,"辅助","muted");button(actions,"按此乐谱生成新版本","主要",304,48,"progress");
}
return {createdNodeIds:[...new Set([...created,...affected.flatMap(r=>r.findAll(()=>true).map(n=>n.id))])],mutatedNodeIds:mutated,links,extras,audits:affected.map(audit)};
