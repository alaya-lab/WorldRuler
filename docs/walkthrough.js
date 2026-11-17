(()=>{
const root=document.getElementById('wr-walkthrough');
if(!root)return;
const cv=root.querySelector('.wr-gl'),ov=root.querySelector('.wr-overlay'),ctx=ov.getContext('2d'),video=root.querySelector('.wr-frame');
const playButton=root.querySelector('.wr-play'),message=root.querySelector('.wr-message'),loadingView=root.querySelector('.wr-loading');
let frames=[],manifest,binary,points,loadingPromise,selectedChapter=-1,videoCallbackPending=false;
const colors=['#89918e','#66bde8','#e29b82','#e1cd76','#b6a2e0'],names={actor:'Player',monster:'Goblin',key:'Key',gate:'Gate'},roleId={actor:1,monster:2,key:3,gate:4};
const rules=[{id:'01',color:'#e29b82',focus:['actor','monster','key']},{id:'02',color:'#66bde8',focus:['actor','key']},{id:'03',color:'#b6a2e0',focus:['actor','key','gate']}];
const allRoles=[...new Set(rules.flatMap(r=>r.focus))];
const state={step:0,labels:true};let cam,dragging=false,drawPending=false,W=1,H=1,reserve=80,viewH=250,MVP;
// Camera basis, lookAt, perspective and orbit semantics adapted from project viz/viz3d.py.
// Payload uses its handedness-preserving OpenCV -> OpenGL conversion (x,-y,-z).
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function norm(a){const l=Math.hypot(...a)||1;return a.map(v=>v/l);}
function mul(a,b){const o=new Float32Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+j]*b[i*4+k];o[i*4+j]=s;}return o;}
function persp(f,ar,n,fa){const t=1/Math.tan(f/2),o=new Float32Array(16);o[0]=t/ar;o[5]=t;o[10]=(fa+n)/(n-fa);o[11]=-1;o[14]=2*fa*n/(n-fa);return o;}
function look(e,c){const z=norm(e.map((v,i)=>v-c[i])),x=norm(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,e),-dot(y,e),-dot(z,e),1]);}
function eye(){const {az,el,dist,tgt}=cam;return [tgt[0]+dist*Math.cos(el)*Math.sin(az),tgt[1]+dist*Math.sin(el),tgt[2]+dist*Math.cos(el)*Math.cos(az)];}
function fit(){const all=frames[state.step].objects.flatMap(o=>o.corners);if(!all.length)return;const lo=[0,1,2].map(i=>Math.min(...all.map(p=>p[i]))),hi=[0,1,2].map(i=>Math.max(...all.map(p=>p[i])));const tgt=lo.map((v,i)=>(v+hi[i])/2),radius=Math.hypot(...hi.map((v,i)=>(v-lo[i])/2));cam={az:0,el:.14,dist:Math.max(3,radius/Math.sin(.45)*1.2),tgt};}
function ruleStatus(i){const o=frames[state.step].observation;if(i===0)return 'Key '+(o.key_state==='ground'?'on ground':o.key_state.replaceAll('_',' '));return 'Unconfirmed';}
function project(p){const x=MVP[0]*p[0]+MVP[4]*p[1]+MVP[8]*p[2]+MVP[12],y=MVP[1]*p[0]+MVP[5]*p[1]+MVP[9]*p[2]+MVP[13],z=MVP[2]*p[0]+MVP[6]*p[1]+MVP[10]*p[2]+MVP[14],w=MVP[3]*p[0]+MVP[7]*p[1]+MVP[11]*p[2]+MVP[15];if(w<=.001||z/w< -1||z/w>1)return null;return [(x/w*.5+.5)*W,reserve+(1-(y/w*.5+.5))*viewH,w];}
const gl=cv.getContext('webgl',{antialias:true,alpha:false,preserveDrawingBuffer:true});let gpu,locations,buffers,backgroundBuffers,fallback,lastBackgroundCount=-1;
if(gl){
function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
gpu=gl.createProgram();gl.attachShader(gpu,sh(gl.VERTEX_SHADER,`attribute vec3 aPos;attribute vec3 aCol;attribute float aRole;uniform mat4 uMVP;uniform vec4 uFocus;uniform float uDpr;varying vec3 vColor;void main(){gl_Position=uMVP*vec4(aPos,1.);float f=0.;vec3 c=aCol*.7;if(aRole>.5){vec3 semantic=vec3(.4,.74,.91);f=uFocus.x;if(aRole>1.5){semantic=vec3(.89,.61,.51);f=uFocus.y;}if(aRole>2.5){semantic=vec3(.88,.8,.46);f=uFocus.z;}if(aRole>3.5){semantic=vec3(.71,.64,.88);f=uFocus.w;}c=mix(aCol,semantic,.76)*(.65+f*.35);}vColor=c;gl_PointSize=clamp((1.8+f)*16./max(gl_Position.w,.1),1.,6.)*uDpr;}`));
gl.attachShader(gpu,sh(gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 vColor;void main(){if(length(gl_PointCoord-vec2(.5))>.5)discard;gl_FragColor=vec4(vColor,1.);}`));gl.linkProgram(gpu);if(!gl.getProgramParameter(gpu,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(gpu));
locations={pos:gl.getAttribLocation(gpu,'aPos'),col:gl.getAttribLocation(gpu,'aCol'),kind:gl.getAttribLocation(gpu,'aRole'),mvp:gl.getUniformLocation(gpu,'uMVP'),focus:gl.getUniformLocation(gpu,'uFocus'),dpr:gl.getUniformLocation(gpu,'uDpr')};buffers=[gl.createBuffer(),gl.createBuffer(),gl.createBuffer()];backgroundBuffers=[gl.createBuffer(),gl.createBuffer(),gl.createBuffer()];root.dataset.renderer='webgl';
}else{fallback=cv.getContext('2d');root.dataset.renderer='canvas3d';}
function readCloud({offset,count,totalCount=count}){return {pos:new Float32Array(binary,offset,count*3),col:new Uint8Array(binary,offset+totalCount*12,count*3),kind:new Uint8Array(binary,offset+totalCount*15,count)};}
function upload(){
 const f=frames[state.step],bg=readCloud(f.background),fg=readCloud(f.cloud);
 points={background:bg,foreground:fg};root.dataset.backgroundPoints=String(bg.kind.length);
 if(gl){
  if(bg.kind.length!==lastBackgroundCount){[bg.pos,bg.col,bg.kind].forEach((a,i)=>{gl.bindBuffer(gl.ARRAY_BUFFER,backgroundBuffers[i]);gl.bufferData(gl.ARRAY_BUFFER,a,gl.STATIC_DRAW);});lastBackgroundCount=bg.kind.length;}
  [fg.pos,fg.col,fg.kind].forEach((a,i)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buffers[i]);gl.bufferData(gl.ARRAY_BUFFER,a,gl.DYNAMIC_DRAW);});
 }
}
function queueDraw(){if(!drawPending){drawPending=true;requestAnimationFrame(()=>{drawPending=false;draw();});}}
function draw(){
if(!cam||!points)return;const f=frames[state.step],rect=cv.parentElement.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);W=Math.max(1,rect.width);H=Math.max(1,rect.height);const note=root.querySelector('.wr-rule-list');reserve=note.offsetTop+note.offsetHeight+15;viewH=Math.max(40,H-reserve-30);
for(const c of [cv,ov]){const w=Math.round(W*dpr),h=Math.round(H*dpr);if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;}
MVP=mul(persp(.9,W/viewH,.05,2000),look(eye(),cam.tgt));const focus=[1,2,3,4].map(k=>allRoles.some(r=>roleId[r]===k)?1:0);
if(gl){gl.viewport(0,0,cv.width,cv.height);gl.clearColor(.067,.067,.086,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.viewport(0,Math.round(30*dpr),cv.width,Math.round(viewH*dpr));gl.enable(gl.DEPTH_TEST);gl.useProgram(gpu);gl.uniformMatrix4fv(locations.mvp,false,MVP);gl.uniform4fv(locations.focus,focus);gl.uniform1f(locations.dpr,dpr);function drawCloud(cloud,cloudBuffers){[[locations.pos,3,gl.FLOAT,false],[locations.col,3,gl.UNSIGNED_BYTE,true],[locations.kind,1,gl.UNSIGNED_BYTE,false]].forEach((a,i)=>{gl.bindBuffer(gl.ARRAY_BUFFER,cloudBuffers[i]);gl.enableVertexAttribArray(a[0]);gl.vertexAttribPointer(a[0],a[1],a[2],a[3],0,0);});gl.drawArrays(gl.POINTS,0,cloud.kind.length);}
drawCloud(points.background,backgroundBuffers);drawCloud(points.foreground,buffers);
}else{
 fallback.setTransform(dpr,0,0,dpr,0,0);fallback.fillStyle='#111116';fallback.fillRect(0,0,W,H);
 const projected=[];
 for(const cloud of [points.background,points.foreground]){
  const stride=cloud===points.background?Math.max(1,Math.ceil(manifest.backgroundAccumulation.points/24000)):1;
  for(let i=0;i<cloud.kind.length;i+=stride){const q=project(cloud.pos.subarray(i*3,i*3+3));if(q&&q[0]>=0&&q[0]<W&&q[1]>=reserve&&q[1]<reserve+viewH)projected.push({q,i,cloud});}
 }
 projected.sort((a,b)=>b.q[2]-a.q[2]);
 for(const {q,i,cloud} of projected){fallback.fillStyle=cloud.kind[i]?colors[cloud.kind[i]]:`rgb(${cloud.col[i*3]},${cloud.col[i*3+1]},${cloud.col[i*3+2]})`;fallback.fillRect(q[0],q[1],1.6,1.6);}
}
ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);ctx.save();ctx.beginPath();ctx.rect(0,reserve-8,W,viewH+8);ctx.clip();
const targets=new Map(),unresolved=[];
for(const role of allRoles){const o=f.objects.find(o=>o.role===role),q=o?project(o.point):null;if(q&&q[0]>8&&q[0]<W-8&&q[1]>reserve&&q[1]<H-30)targets.set(role,{q,resolved:true});else unresolved.push({role,reason:o?'off view':'unlocated'});}
const cols=Math.max(1,Math.floor((W-16)/125)),rows=Math.ceil(unresolved.length/cols);
unresolved.forEach((t,i)=>{const col=i%cols,row=Math.floor(i/cols),count=Math.min(cols,unresolved.length-row*cols),q=[8+(col+.5)*(W-16)/count,H-43-(rows-1-row)*21];targets.set(t.role,{q,resolved:false,reason:t.reason});});
let edgeCount=0;
rules.forEach((rule,ri)=>{const card=root.querySelector(`[data-rule="${ri}"]`).getBoundingClientRect(),links=rule.focus.map(role=>({role,...targets.get(role)})).sort((a,b)=>a.q[0]-b.q[0]);links.forEach((t,j)=>{const sx=card.left-rect.left+card.width*(j+1)/(links.length+1),sy=reserve-7,q=t.q;ctx.strokeStyle=rule.color;ctx.globalAlpha=t.resolved ? .85 : .6;ctx.lineWidth=2;ctx.setLineDash(t.resolved?[]:[3,4]);ctx.beginPath();ctx.moveTo(sx,sy);ctx.bezierCurveTo(sx,sy+18,q[0]+(ri-1)*12,q[1]-24,q[0],q[1]);ctx.stroke();edgeCount++;});});
ctx.setLineDash([]);root.dataset.ruleCount=String(rules.length);root.dataset.ruleEdges=String(edgeCount);root.dataset.unresolved=unresolved.map(t=>t.role+':'+t.reason).join(',');
const placed=[];
if(state.labels)for(const o of f.objects){const active=allRoles.includes(o.role),cs=o.corners.map(project);ctx.strokeStyle=colors[roleId[o.role]];ctx.globalAlpha=active ? .7 : .28;ctx.lineWidth=.8;for(let i=0;i<8;i++)for(const bit of [1,2,4]){const j=i^bit;if(j<=i||!cs[i]||!cs[j])continue;ctx.beginPath();ctx.moveTo(cs[i][0],cs[i][1]);ctx.lineTo(cs[j][0],cs[j][1]);ctx.stroke();}
const q=project(o.point);if(!q||q[0]<0||q[0]>W||q[1]<reserve||q[1]>H-30)continue;let label=names[o.role];if(o.role==='monster')label+=' · '+f.observation.monster_state.replaceAll('_',' ');if(o.role==='key')label+=' · '+f.observation.key_state.replaceAll('_',' ');if(o.role==='gate')label+=' · '+f.observation.gate_state.replaceAll('_',' ');ctx.font='11px Arial';const tw=ctx.measureText(label).width;let x=Math.max(4,Math.min(W-tw-8,q[0]+6)),y=Math.max(reserve+13,Math.min(H-36,q[1]-8));for(let n=0;n<5&&placed.some(b=>x<b.x+b.w&&x+tw>b.x&&y-12<b.y+3&&y>b.y-12);n++)y=Math.min(H-34,y+16);placed.push({x,y,w:tw});ctx.globalAlpha=1;ctx.fillStyle='#111116ed';ctx.fillRect(x-3,y-11,tw+6,15);ctx.fillStyle=active?colors[roleId[o.role]]:'#aaa7b2';ctx.fillText(label,x,y);}
ctx.globalAlpha=1;ctx.font='11px Arial';
for(const {role,reason} of unresolved){const q=targets.get(role).q,label=names[role]+' · '+reason,tw=ctx.measureText(label).width,x=Math.max(5,Math.min(W-tw-7,q[0]-tw/2));ctx.fillStyle='#111116f5';ctx.fillRect(x-4,q[1]-8,tw+8,17);ctx.strokeStyle=colors[roleId[role]];ctx.setLineDash([2,3]);ctx.strokeRect(x-4,q[1]-8,tw+8,17);ctx.setLineDash([]);ctx.fillStyle='#c0bbc9';ctx.fillText(label,x,q[1]+4);}
ctx.restore();ctx.globalAlpha=1;
}
function orbit(dx,dy){cam.az-=dx*.006;cam.el=Math.max(-1.45,Math.min(1.45,cam.el+dy*.006));}
function pan(dx,dy){const e=eye(),fw=norm(cam.tgt.map((v,i)=>v-e[i])),rt=norm(cross(fw,[0,1,0])),up=cross(rt,fw),k=cam.dist*2*Math.tan(.45)/viewH;for(let i=0;i<3;i++)cam.tgt[i]+=-rt[i]*dx*k+up[i]*dy*k;}
function zoom(ratio){cam.dist=Math.max(.3,Math.min(300,cam.dist*ratio));}
const pointers=new Map();
cv.addEventListener('pointerdown',e=>{if(!cam||![0,1,2].includes(e.button))return;e.preventDefault();cv.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,pan:e.shiftKey||e.button===2||e.button===1});dragging=true;});
cv.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const old=[...pointers.values()].map(p=>({...p})),p=pointers.get(e.pointerId),dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;const now=[...pointers.values()];if(now.length>=2){const d0=Math.hypot(old[0].x-old[1].x,old[0].y-old[1].y),d1=Math.hypot(now[0].x-now[1].x,now[0].y-now[1].y);if(d0>1&&d1>1)zoom(d0/d1);pan(((now[0].x+now[1].x)-(old[0].x+old[1].x))/2,((now[0].y+now[1].y)-(old[0].y+old[1].y))/2);}else if(p.pan||e.shiftKey)pan(dx,dy);else orbit(dx,dy);queueDraw();e.preventDefault();});
function end(e){pointers.delete(e.pointerId);dragging=pointers.size>0;}
cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);cv.addEventListener('lostpointercapture',e=>pointers.delete(e.pointerId));cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('wheel',e=>{if(!cam)return;e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?viewH:1);zoom(Math.exp(Math.max(-500,Math.min(500,delta))*.0011));queueDraw();},{passive:false});

cv.addEventListener('keydown',event=>{
 if(!cam||event.altKey||event.ctrlKey||event.metaKey)return;
 const movement={ArrowLeft:[-15,0],ArrowRight:[15,0],ArrowUp:[0,-15],ArrowDown:[0,15]}[event.key];
 if(movement){if(event.shiftKey)pan(...movement);else orbit(...movement);}
 else if(event.key==='+'||event.key==='=')zoom(.85);
 else if(event.key==='-')zoom(1.15);
 else if(event.key==='Home')fit();
 else return;
 event.preventDefault();queueDraw();
});

function updateTime(time){
 root.querySelector('output').textContent=time.toFixed(2)+' / '+manifest.duration.toFixed(2)+' s';
}

function setFrame(index,force=false){
 if(!frames.length)return;
 index=Math.max(0,Math.min(frames.length-1,index));
 if(!force&&root.dataset.frame===String(index))return;
 state.step=index;
 root.dataset.frame=String(index);
 root.querySelector('.wr-frame-id').textContent='FRAME '+String(index).padStart(3,'0');
 root.querySelectorAll('.wr-rule-state').forEach((el,i)=>{const text=ruleStatus(i);if(el.textContent!==text)el.textContent=text;});
 let chapter=0;
 manifest.chapters.forEach((item,i)=>{if(index>=item.frame)chapter=i;});
 if(chapter!==selectedChapter){
  selectedChapter=chapter;root.dataset.chapter=String(chapter);
  root.querySelector('.wr-caption').textContent=manifest.chapters[chapter].title;
  root.querySelectorAll('[data-step]').forEach((button,i)=>button.setAttribute('aria-pressed',String(i===chapter)));
 }
 upload();queueDraw();
}

function synchronize(time){
 if(!manifest)return;
 setFrame(Math.floor(time*manifest.fps+1e-4));updateTime(time);
}

// Use the presented video frame, so the graph follows actual decoded footage.
function scheduleVideoFrame(){
 if(videoCallbackPending||video.paused||video.ended||!manifest)return;
 videoCallbackPending=true;
 if(video.requestVideoFrameCallback){
  video.requestVideoFrameCallback((_,metadata)=>{videoCallbackPending=false;synchronize(metadata.mediaTime);scheduleVideoFrame();});
 }else requestAnimationFrame(()=>{videoCallbackPending=false;synchronize(video.currentTime);scheduleVideoFrame();});
}

function updatePlay(){
 playButton.textContent=video.paused?'▷ Play':'Ⅱ Pause';
 playButton.setAttribute('aria-label',video.paused?'Play synchronized walkthrough':'Pause synchronized walkthrough');
}

async function play(){
 message.textContent='';
 try{
  if(video.ended)video.currentTime=0;
  await video.play();
 }catch(error){if(error.name!=='AbortError')message.textContent='Playback could not start. Please try again.';}
 updatePlay();
}

playButton.addEventListener('click',()=>{if(video.paused)play();else video.pause();});
root.querySelector('.wr-replay').addEventListener('click',()=>{video.currentTime=0;play();});
root.querySelector('.wr-reset').addEventListener('click',()=>{fit();queueDraw();});
root.querySelectorAll('[data-step]').forEach(button=>button.addEventListener('click',()=>{
 video.pause();
 // Stop at the selected chapter for inspection; Play resumes the full sequence.
 video.currentTime=manifest.chapters[Number(button.dataset.step)].frame/manifest.fps;
}));
video.addEventListener('play',()=>{updatePlay();scheduleVideoFrame();});
video.addEventListener('pause',()=>{updatePlay();synchronize(video.currentTime);});
video.addEventListener('ended',()=>{updatePlay();synchronize(video.duration);});
video.addEventListener('seeked',()=>{synchronize(video.currentTime);scheduleVideoFrame();});
video.addEventListener('loadeddata',()=>synchronize(video.currentTime));
video.addEventListener('timeupdate',()=>{if(manifest)updateTime(video.currentTime);});
video.addEventListener('error',()=>{message.textContent='The video could not load. Reload the page to try again.';});

function prepareVideo(){
 return new Promise((resolve,reject)=>{
  if(video.readyState>=1){resolve();return;}
  const cleanup=()=>{clearTimeout(timeout);video.removeEventListener('loadedmetadata',ready);video.removeEventListener('error',failed);};
  const ready=()=>{cleanup();resolve();};
  const failed=()=>{cleanup();reject(new Error('Video unavailable'));};
  const timeout=setTimeout(failed,20000);
  video.addEventListener('loadedmetadata',ready,{once:true});video.addEventListener('error',failed,{once:true});
  video.src=video.dataset.src;video.load();
 });
}

async function loadScene(){
 if(loadingPromise)return loadingPromise;
 root.dataset.status='loading';loadingView.hidden=false;
 loadingView.querySelector('span').textContent='Loading 3D view…';
 root.querySelector('.wr-retry').hidden=true;message.textContent='';
 loadingPromise=(async()=>{
  const get=async(path,type)=>{const response=await fetch(path);if(!response.ok)throw new Error('Unable to load '+path);return response[type]();};
  const [data,geometry]=await Promise.all([
   get('assets/walkthrough-combat-v2-20261117/scene.json','json'),
   get('assets/walkthrough-combat-v2-20261117/geometry.bin','arrayBuffer'),
   prepareVideo()
  ]);
  if(geometry.byteLength!==data.geometryBytes||data.frames.length!==data.frameCount)throw new Error('Incomplete geometry');
  manifest=data;binary=geometry;frames=data.frames;
  fit();setFrame(0,true);synchronize(video.currentTime);
  root.querySelectorAll('button').forEach(button=>button.disabled=false);
  loadingView.hidden=true;root.dataset.status='ready';
 })().catch(()=>{
  root.dataset.status='error';loadingView.querySelector('span').textContent='The 3D view could not load.';
  root.querySelector('.wr-retry').hidden=false;loadingPromise=null;
 });
 return loadingPromise;
}

root.querySelector('.wr-retry').addEventListener('click',loadScene);
new ResizeObserver(queueDraw).observe(cv.parentElement);
if('IntersectionObserver' in window){
 const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){loadScene();observer.disconnect();}},{rootMargin:'500px'});
 observer.observe(root);
 new IntersectionObserver(([entry])=>{if(!entry.isIntersecting)video.pause();}).observe(root);
}else loadScene();
})();
