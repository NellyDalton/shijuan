/** =========================
 *  0. 默认量表（可改）
 *  ========================= */
const DEFAULT_RUBRIC = {
  total: 100,
  dims: {
    content: { max: 30 },
    structure: { max: 20 },
    language: { max: 30 },
    neatness: { max: 20 }
  }
};

/** =========================
 *  1. 全局状态
 *  ========================= */
const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

const STATE = {
  apiKey: sessionStorage.getItem("zp_key_v112") || "",
  promptImg: null,  // dataURL
  jobs: [],         // {id,name,essayDataUrl,status,result,err,rawVision,rawText,startedAt,endedAt}
  done: 0,
  selectedJobId: null,

  // viewport pan/zoom
  scale: 1,
  panX: 0,
  panY: 0,
  dragging:false,
  sx:0, sy:0,

  // UI tab states
  mainTab: "queue",
  resultSubTab: "overview",

  // debug
  lastReq: null,
  lastRes: null,

  // left shown
  leftShown: true,
};

/** =========================
 *  2. DOM
 *  ========================= */
const $ = (id)=>document.getElementById(id);

const keyModal = $("keyModal");
const keyState = $("keyState");
const promptState = $("promptState");
const qState = $("qState");
const doneState = $("doneState");

const panelQueue = $("panelQueue");
const panelResult = $("panelResult");
const panelSettings = $("panelSettings");
const panelExport = $("panelExport");

const essayFiles = $("essayFiles");
const promptFile = $("promptFile");

const leftPane = $("leftPane");

const viewport = $("viewport");
const wrapper = $("wrapper");
const essayImg = $("essayImg");
const overlayCanvas = $("overlayCanvas");
const octx = overlayCanvas.getContext("2d");
const focusBox = $("focusBox");
const empty = $("empty");

const dbgPanel = $("debugPanel");
const dbgReq = $("dbgReq");
const dbgRes = $("dbgRes");

/** =========================
 *  3. 工具函数
 *  ========================= */
function escapeHtml(s){
  if(!s) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
function safeJsonParse(txt){
  try { return JSON.parse(txt); } catch { return null; }
}
function extractJsonObject(str){
  if(!str) return null;
  const t = String(str).replace(/```json|```/g,"").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if(a === -1 || b === -1 || b <= a) return null;
  return t.slice(a, b+1);
}
function now(){ return new Date().toISOString(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
async function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// 改进后的压缩函数：对长图更友好
async function compressDataUrl(dataUrl, maxSide=1100, quality=0.78){
  const img = new Image();
  img.src = dataUrl;
  await new Promise(res=>img.onload=res);

  let w = img.naturalWidth, h = img.naturalHeight;
  
  // 判断是否为长图 (如3页拼在一起的试卷)
  const isLongStrip = h > w * 2.2;

  if(isLongStrip){
    // 长图策略：限制宽度，高度允许按比例延伸（保留清晰度）
    if(w > maxSide){
      const r = maxSide / w;
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    // 二次检查：如果高度实在太夸张（如超过8000px），强制限制高度
    if(h > 8000){
      const r = 8000 / h;
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
  } else {
    // 普通图片：限制最长边
    if(w > maxSide || h > maxSide){
      const r = Math.min(maxSide/w, maxSide/h);
      w = Math.round(w*r);
      h = Math.round(h*r);
    }
  }

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,w,h); // 防止透明背景变黑
  ctx.drawImage(img, 0,0,w,h);
  return c.toDataURL("image/jpeg", quality);
}

// 垂直拼图函数
async function stitchImages(dataUrlList) {
  if (!dataUrlList || dataUrlList.length === 1) return dataUrlList[0];

  const images = await Promise.all(dataUrlList.map(src => {
    return new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
  }));

  const w = images[0].naturalWidth;
  let h = 0;
  images.forEach(img => h += img.naturalHeight * (w / img.naturalWidth));

  // 安全限制
  const maxH = 16000;
  const scale = h > maxH ? (maxH / h) : 1;

  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = 0;
  images.forEach(img => {
    const drawH = (img.naturalHeight * (w / img.naturalWidth)) * scale;
    ctx.drawImage(img, 0, y, canvas.width, drawH);
    // 画一条分割线
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); 
    ctx.strokeStyle="rgba(0,0,0,0.1)"; ctx.lineWidth=2; ctx.stroke();
    y += drawH;
  });

  return canvas.toDataURL("image/jpeg", 0.85);
}

function downloadText(filename, text, mime="application/octet-stream"){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function copyToClipboard(text){
  navigator.clipboard?.writeText(text).catch(()=>{});
}

/** =========================
 *  4. 设置项（保存在localStorage）
 *  ========================= */
function getSettings(){
  const topic = (localStorage.getItem("zp_topic_v112") || "").trim();
  const mode  = (localStorage.getItem("zp_mode_v112") || "std");
  const rawRub = (localStorage.getItem("zp_rubric_v112") || "");
  const rubricObj = safeJsonParse(rawRub) || DEFAULT_RUBRIC;

  const visionModel = localStorage.getItem("zp_vision_model_v112") || "glm-4v-flash";
  const textModel   = localStorage.getItem("zp_text_model_v112") || "glm-4.6";
  const maxSide     = Number(localStorage.getItem("zp_imgmax_v112") || "1100");
  const concurrency = Math.max(1, Math.min(6, Number(localStorage.getItem("zp_conc_v112") || "2")));

  const visionModels = [visionModel, "glm-4v-flash", "glm-4v", "glm-4.6v-flash"].filter((v,i,a)=>v && a.indexOf(v)===i);
  const textModels   = [textModel, "glm-4.6", "glm-4", "glm-4-flash"].filter((v,i,a)=>v && a.indexOf(v)===i);

  return {topic, mode, rubricObj, visionModels, textModels, maxSide, concurrency};
}

/** =========================
 *  5. 交互：拖拽/缩放/定位
 *  ========================= */
function updateTransform(animate=false){
  wrapper.style.transition = animate ? "transform .45s cubic-bezier(.2,.8,.2,1)" : "none";
  wrapper.style.transform = `translate(${STATE.panX}px, ${STATE.panY}px) scale(${STATE.scale})`;
}
viewport.addEventListener("mousedown", (e)=>{
  STATE.dragging=true;
  STATE.sx = e.clientX - STATE.panX;
  STATE.sy = e.clientY - STATE.panY;
  viewport.style.cursor="grabbing";
});
window.addEventListener("mousemove",(e)=>{
  if(!STATE.dragging) return;
  e.preventDefault();
  STATE.panX = e.clientX - STATE.sx;
  STATE.panY = e.clientY - STATE.sy;
  updateTransform(false);
});
window.addEventListener("mouseup", ()=>{
  STATE.dragging=false;
  viewport.style.cursor="grab";
});
viewport.addEventListener("wheel",(e)=>{
  e.preventDefault();
  const speed = 0.12;
  const dir = e.deltaY>0 ? -1 : 1;
  const factor = 1 + dir*speed;

  const rect = wrapper.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const old = STATE.scale;
  let ns = old * factor;
  ns = Math.max(0.12, Math.min(ns, 6));

  STATE.panX -= (mx / old) * (ns - old);
  STATE.panY -= (my / old) * (ns - old);
  STATE.scale = ns;

  updateTransform(false);
},{passive:false});

function initCanvasForImage(imgW, imgH){
  overlayCanvas.width = imgW;
  overlayCanvas.height= imgH;

  const vpW = viewport.clientWidth;
  const vpH = viewport.clientHeight;
  const s = Math.min(vpW/imgW, vpH/imgH) * 0.92;
  STATE.scale = s;
  STATE.panX = (vpW - imgW*s)/2;
  STATE.panY = (vpH - imgH*s)/2;
  updateTransform(false);
}
function drawBoxes(annotations, imgW, imgH){
  octx.clearRect(0,0,overlayCanvas.width, overlayCanvas.height);
  (annotations||[]).forEach(a=>{
    if(!a?.pos || a.pos.length!==4) return;
    const [ymin,xmin,ymax,xmax] = a.pos;
    const x = (xmin/1000)*imgW;
    const y = (ymin/1000)*imgH;
    const w = ((xmax-xmin)/1000)*imgW;
    const h = ((ymax-ymin)/1000)*imgH;

    const isErr = a.type === "error";
    octx.lineWidth = 3;
    octx.strokeStyle = isErr ? "#fb7185" : "#10b981";
    octx.fillStyle   = isErr ? "rgba(251,113,133,.14)" : "rgba(16,185,129,.14)";
    octx.strokeRect(x,y,w,h);
    octx.fillRect(x,y,w,h);
  });
}
function showFocus(pos){
  if(!pos || pos.length !== 4) return;
  const job = STATE.jobs.find(j=>j.id===STATE.selectedJobId);
  if(!job?.result?.ocr_meta?.imgW) return;

  const imgW = job.result.ocr_meta.imgW;
  const imgH = job.result.ocr_meta.imgH;

  const [ymin,xmin,ymax,xmax] = pos;
  const x = (xmin/1000)*imgW;
  const y = (ymin/1000)*imgH;
  const w = ((xmax-xmin)/1000)*imgW;
  const h = ((ymax-ymin)/1000)*imgH;

  const cx = x + w/2;
  const cy = y + h/2;
  const targetScale = Math.max(STATE.scale, 0.85);
  STATE.scale = targetScale;
  STATE.panX = (viewport.clientWidth/2) - (cx*targetScale);
  STATE.panY = (viewport.clientHeight/2) - (cy*targetScale);
  updateTransform(true);

  focusBox.style.display = "block";
  focusBox.style.left = x + "px";
  focusBox.style.top  = y + "px";
  focusBox.style.width = w + "px";
  focusBox.style.height= h + "px";
  focusBox.classList.remove("flash");
  void focusBox.offsetWidth;
  focusBox.classList.add("flash");
  clearTimeout(window.__flashTimer);
  window.__flashTimer = setTimeout(()=>focusBox.style.display="none", 2600);
}

/** =========================
 *  6. Prompt 生成（两段式）
 *  ========================= */
function buildVisionPrompt(topic, rubricObj, mode, hasPromptImage){
  return [
`你是一位小学语文特级教师助教，从【作文照片】提取OCR文本并定位批注位置。`,
`只输出一个【JSON对象】（不要Markdown，不要多余解释）。`,
`必须包含字段：`,
`{ "ocr_text": "...", "annotations":[{"type":"error|good","text":"...","fix":"...","reason":"...","pos":[ymin,xmin,ymax,xmax]}], "picture_desc":"..." }`,
`要求：`,
`1) annotations 至少 6 条（错别字/病句/标点/重复/亮点句尽量都覆盖）。`,
`2) pos 用 0-1000 相对坐标（ymin,xmin,ymax,xmax）。`,
`3) 不要输出 reasoning_content。`,
`补充：题目/任务：${topic ? topic : "（未提供，按作文内容判断）"}；模式：${mode}；是否提供题图：${hasPromptImage?"是":"否"}`
  ].join("\n");
}
function buildTextPrompt(topic, rubricObj, mode, visionJson){
  const wantFast = (mode === "fast");
  const wantPro  = (mode === "pro");

  const schemaStd = `
{
  "total_score": 90,
  "rubric": {
    "content":   {"score": 26, "max": 30, "comment": "......"},
    "structure": {"score": 18, "max": 20, "comment": "......"},
    "language":  {"score": 27, "max": 30, "comment": "......"},
    "neatness":  {"score": 19, "max": 20, "comment": "......"}
  },
  "teacher_comment": "80-120字，先扬后抑，具体可操作",
  "improvements": {
    "审题立意": ["1-2条"],
    "内容细节": ["1-2条"],
    "结构条理": ["1-2条"],
    "语言表达": ["1-2条"],
    "标点书写": ["1-2条"],
    "错别字病句": ["1-2条"]
  },
  "rewrite": {"original":"原句","improved":"升格句","technique":"技巧"},
  "model_essay": {"title":"范文题目","text":"120-180字范文","highlights":["亮点1","亮点2"]},
  "exercises": [
    {"q":"题目1","answer":"答案1","skill":"能力点"},
    {"q":"题目2","answer":"答案2","skill":"能力点"}
  ],
  "annotations": [
    {"type":"error|good","text":"原文片段","fix":"修改建议(亮点可空)","reason":"解释","pos":[ymin,xmin,ymax,xmax]}
  ],
  "ocr_text": "全文OCR..."
}
`.trim();

  const schemaFast = `
{
  "total_score": 90,
  "rubric": {
    "content":   {"score": 26, "max": 30, "comment": "......"},
    "structure": {"score": 18, "max": 20, "comment": "......"},
    "language":  {"score": 27, "max": 30, "comment": "......"},
    "neatness":  {"score": 19, "max": 20, "comment": "......"}
  },
  "teacher_comment": "80-120字点评",
  "rewrite": {"original":"原句","improved":"升格句","technique":"技巧"},
  "annotations": [
    {"type":"error|good","text":"原文片段","fix":"修改建议(亮点可空)","reason":"解释","pos":[ymin,xmin,ymax,xmax]}
  ],
  "ocr_text": "全文OCR..."
}
`.trim();

  const schema = wantFast ? schemaFast : schemaStd;
  const rubricText = JSON.stringify(rubricObj, null, 2);

  return [
`你是一位小学语文特级教师。根据 OCR、题目/题图描述、阅卷标准输出【严格合法JSON对象】。`,
`【硬性规则】`,
`1) 只输出JSON对象（不要Markdown，不要解释文字）。`,
`2) rubric 四项必须是对象：{score,max,comment}，max 使用阅卷标准对应满分。`,
`3) total_score 必须等于四项score之和。`,
`4) annotations 必须为对象数组，且不少于 6 条（标准/精批建议 8-12）。`,
`5) 不要出现 reasoning_content。`,
`6) teacher_comment 80-120字，先扬后抑，可操作建议。`,
wantFast ? `7) 极速模式可省略 improvements/model_essay/exercises。` : `7) 标准/精批必须给 improvements、model_essay、exercises。`,
wantPro ? `8) 精批：建议更具体，但不要超长避免截断。` : `8) 结果要清晰不冗长。`,
`【作文题目/任务】${topic ? topic : "（未提供，按ocr_text与picture_desc判断）"}`,
`【阅卷标准JSON】\n${rubricText}`,
`【视觉提取结果】\n${JSON.stringify(visionJson, null, 2)}`,
`【目标结构示例】\n${schema}`,
`现在输出最终JSON：`
  ].join("\n");
}

/** =========================
 *  7. 请求：安全 fetch + 兼容降级
 *  ========================= */
async function postJSON(payload){
  if(!STATE.apiKey) throw new Error("未设置API Key");

  STATE.lastReq = payload;
  dbgReq.textContent = JSON.stringify(payload, null, 2);

  const res = await fetch(API_URL, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization": `Bearer ${STATE.apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  STATE.lastRes = text;
  dbgRes.textContent = text;

  let json = null;
  try{ json = JSON.parse(text); }catch{}

  if(!res.ok){
    const code = json?.error?.code;
    const msg  = json?.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = code;
    err.http = res.status;
    err.raw  = text;
    throw err;
  }
  return json;
}

async function callTextModelWithFallback(models, basePayload){
  let lastErr = null;
  for(const model of models){
    const steps = [
      (p)=>p,
      (p)=>{ const q = structuredClone(p); delete q.thinking; delete q.do_sample; return q; },
      (p)=>{ const q = structuredClone(p); delete q.response_format; delete q.thinking; delete q.do_sample; return q; }
    ];
    for(const mk of steps){
      const payload = mk(structuredClone(basePayload));
      payload.model = model;
      try{
        const out = await postJSON(payload);
        return {out, usedModel:model};
      }catch(e){
        lastErr = e;
        if(String(e.code) === "1220") break;     // 无权访问模型：换模型
        if(String(e.code) === "1210") continue;  // 参数问题：换step
        continue;
      }
    }
  }
  throw lastErr || new Error("文本模型调用失败");
}

async function callVisionModelWithFallback(models, basePayload){
  let lastErr = null;
  for(const model of models){
    const payload = structuredClone(basePayload);
    payload.model = model;
    delete payload.response_format;
    delete payload.thinking;
    delete payload.do_sample;

    try{
      const out = await postJSON(payload);
      return {out, usedModel:model};
    }catch(e){
      lastErr = e;
      if(String(e.code)==="1220") continue;
      if(String(e.code)==="1210") continue;
      continue;
    }
  }
  throw lastErr || new Error("视觉模型调用失败");
}

/** =========================
 *  8. JSON自愈 / 结构归一化
 *  ========================= */
function validateAndNormalizeFinal(finalObj, rubricObj){
  if(!finalObj || typeof finalObj !== "object") return null;

  const dims = ["content","structure","language","neatness"];
  finalObj.rubric = finalObj.rubric || {};

  for(const d of dims){
    const max = rubricObj?.dims?.[d]?.max ?? (d==="structure"?20:(d==="neatness"?20:30));
    const v = finalObj.rubric[d];

    if(typeof v === "number"){
      finalObj.rubric[d] = {score:v, max, comment:""};
    }else if(!v || typeof v !== "object"){
      finalObj.rubric[d] = {score:0, max, comment:""};
    }else{
      finalObj.rubric[d].max = (typeof v.max==="number") ? v.max : max;
      finalObj.rubric[d].score = (typeof v.score==="number") ? v.score : 0;
      finalObj.rubric[d].comment = (v.comment ?? "");
    }
  }

  const sum = dims.reduce((a,d)=>a + (Number(finalObj.rubric[d].score)||0), 0);
  finalObj.total_score = sum;

  if(!Array.isArray(finalObj.annotations)) finalObj.annotations = [];
  finalObj.annotations = finalObj.annotations
    .filter(x=>x && typeof x==="object")
    .map(x=>({
      type: x.type==="good" ? "good" : "error",
      text: x.text ?? "",
      fix:  x.fix ?? "",
      reason: x.reason ?? "",
      pos: Array.isArray(x.pos) && x.pos.length===4 ? x.pos.map(n=>Number(n)||0) : null
    }))
    .filter(x=>x.text);

  finalObj.annotations.forEach(a=>{ if(!a.pos) delete a.pos; });
  finalObj.ocr_text = finalObj.ocr_text ?? "";

  return finalObj;
}

async function repairToTarget(rawMixed, topic, rubricObj, textModels){
  const sys = "你是JSON修复器。只输出严格合法JSON对象；不要Markdown；不要解释；不要reasoning_content。";
  const user = [
`把下面可能不完整/夹杂文本/带代码块的内容修复为目标结构JSON：`,
`- rubric.content/structure/language/neatness 必须是对象 {score,max,comment}`,
`- total_score = 四项score之和`,
`- annotations 必须是对象数组且≥6`,
`- ocr_text 必须存在（没有就给空字符串）`,
`- 不要出现 reasoning_content`,
`作文题目：${topic || "（未提供）"}`,
`阅卷标准（JSON）：\n${JSON.stringify(rubricObj,null,2)}`,
`原始输出：\n${rawMixed || ""}`
  ].join("\n");

  const basePayload = {
    model: textModels[0],
    messages: [
      {role:"system", content: sys},
      {role:"user", content: user}
    ],
    temperature: 0,
    max_tokens: 1600,
    response_format: {type:"json_object"},
    thinking: {type:"disabled"},
    do_sample: false
  };

  const {out, usedModel} = await callTextModelWithFallback(textModels, basePayload);
  const content = out?.choices?.[0]?.message?.content || "";
  let obj = safeJsonParse(content);
  if(!obj){
    const j = extractJsonObject(content);
    obj = j ? safeJsonParse(j) : null;
  }
  if(!obj) throw new Error("JSON修复失败（仍不可解析）");
  obj.__used_text_model = usedModel;
  return obj;
}

async function expandAnnotationsIfNeeded(finalObj, topic, rubricObj, mode, textModels){
  const need = (mode==="fast") ? 6 : 8;
  if(finalObj.annotations?.length >= need) return finalObj;

  const sys = "你是作文精批助手。只输出严格合法JSON对象；不要Markdown；不要解释；不要reasoning_content。";
  const user = [
`在不改变评分思路前提下，把 annotations 补到至少 ${need} 条。`,
`每条必须是对象：{type,error/good,text,fix,reason,pos(可选)}。`,
`只输出JSON对象。`,
`作文题目：${topic||"（未提供）"}`,
`阅卷标准：\n${JSON.stringify(rubricObj,null,2)}`,
`当前JSON：\n${JSON.stringify(finalObj,null,2)}`
  ].join("\n");

  const basePayload = {
    model: textModels[0],
    messages: [
      {role:"system", content: sys},
      {role:"user", content: user}
    ],
    temperature: 0,
    max_tokens: 1300,
    response_format: {type:"json_object"},
    thinking: {type:"disabled"},
    do_sample: false
  };

  const {out, usedModel} = await callTextModelWithFallback(textModels, basePayload);
  const content = out?.choices?.[0]?.message?.content || "";
  let obj = safeJsonParse(content);
  if(!obj){
    const j = extractJsonObject(content);
    obj = j ? safeJsonParse(j) : null;
  }
  if(!obj) return finalObj;
  obj.__used_text_model = usedModel;
  return obj;
}

/** =========================
 *  9. 单篇批改（两段式）
 *  ========================= */
async function analyzeJob(job){
  const {topic, mode, rubricObj, visionModels, textModels, maxSide} = getSettings();
  job.startedAt = Date.now();

  const essayCompressed = await compressDataUrl(job.essayDataUrl, maxSide, 0.78);

  // 视觉提取（可选题图）
  const visionPrompt = buildVisionPrompt(topic, rubricObj, mode, !!STATE.promptImg);
  const contentArr = [{type:"text", text: visionPrompt}];

  if(STATE.promptImg){
    const promptCompressed = await compressDataUrl(STATE.promptImg, maxSide, 0.82);
    contentArr.push({type:"image_url", image_url:{url: promptCompressed}});
  }
  contentArr.push({type:"image_url", image_url:{url: essayCompressed}});

  const visionPayload = {
    model: visionModels[0],
    messages: [{role:"user", content: contentArr}],
    temperature: 0.1,
    max_tokens: (mode==="fast") ? 1100 : 1400
  };

  const {out:visionOut, usedModel:usedVision} = await callVisionModelWithFallback(visionModels, visionPayload);
  const vMsg = visionOut?.choices?.[0]?.message?.content || "";
  job.rawVision = vMsg;

  let visionJson = null;
  const vJsonStr = extractJsonObject(vMsg) || vMsg;
  visionJson = safeJsonParse(vJsonStr);

  // 视觉JSON解析失败：用修复器兜底，再抽出必要字段
  if(!visionJson){
    const repaired = await repairToTarget(vMsg, topic, rubricObj, textModels);
    visionJson = {
      ocr_text: repaired.ocr_text || "",
      annotations: repaired.annotations || [],
      picture_desc: repaired.picture_desc || ""
    };
  }

  // 原图尺寸（用于定位/画框）
  const img = new Image();
  img.src = job.essayDataUrl;
  await new Promise(res=>img.onload=res);
  const imgW = img.naturalWidth, imgH = img.naturalHeight;

  // 文本精批（最终结构）
  const textPrompt = buildTextPrompt(topic, rubricObj, mode, visionJson);
  const textPayload = {
    model: textModels[0],
    messages: [
      {role:"system", content:"你是一位小学语文特级教师。只输出严格合法JSON对象；不要Markdown；不要解释；不要reasoning_content。"},
      {role:"user", content: textPrompt}
    ],
    temperature: 0.1,
    max_tokens: (mode==="fast") ? 1400 : (mode==="pro" ? 2300 : 1800),
    response_format: {type:"json_object"},
    thinking: {type:"disabled"},
    do_sample: false
  };

  const {out:textOut, usedModel:usedText} = await callTextModelWithFallback(textModels, textPayload);
  const tMsg = textOut?.choices?.[0]?.message?.content || "";
  job.rawText = tMsg;

  let finalObj = safeJsonParse(tMsg);
  if(!finalObj){
    const j = extractJsonObject(tMsg);
    finalObj = j ? safeJsonParse(j) : null;
  }

  if(!finalObj){
    finalObj = await repairToTarget(tMsg, topic, rubricObj, textModels);
  }

  finalObj = validateAndNormalizeFinal(finalObj, rubricObj);

  finalObj = await expandAnnotationsIfNeeded(finalObj, topic, rubricObj, mode, textModels);
  finalObj = validateAndNormalizeFinal(finalObj, rubricObj);

  finalObj.meta = finalObj.meta || {};
  finalObj.meta.topic = topic || "";
  finalObj.meta.mode = mode;
  finalObj.meta.vision_model = usedVision || "";
  finalObj.meta.text_model = usedText || "";
  finalObj.meta.created_at = now();
  finalObj.ocr_meta = {imgW, imgH};

  job.result = finalObj;
  job.endedAt = Date.now();
}

/** =========================
 *  10. 并发队列执行
 *  ========================= */
async function runQueue(){
  const {concurrency} = getSettings();
  if(!STATE.apiKey){ alert("请先设置API Key"); return; }
  if(STATE.jobs.length === 0){ alert("请先批量上传作文图片"); return; }

  const pending = STATE.jobs.filter(j=>j.status==="queued" || j.status==="error");
  if(pending.length === 0){ alert("队列已完成"); return; }

  const workers = Array.from({length: concurrency}, async ()=>{
    while(true){
      const job = STATE.jobs.find(j=>j.status==="queued");
      if(!job) break;

      job.status = "running";
      job.err = null;
      renderAll();

      try{
        await analyzeJob(job);
        job.status = "done";
        STATE.done += 1;
      }catch(e){
        job.status = "error";
        job.err = job.err || (e?.message || "未知错误");
      }finally{
        renderAll();
      }

      await sleep(120);
    }
  });

  await Promise.all(workers);
}

/** =========================
 *  11. 渲染：主Tab + 子Tab
 *  ========================= */
function setKeyUI(){
  keyState.textContent = STATE.apiKey ? "Key：已设置" : "Key：未设置";
  keyState.style.borderColor = STATE.apiKey ? "rgba(16,185,129,.5)" : "rgba(251,113,133,.55)";
  keyState.style.color = STATE.apiKey ? "var(--good)" : "var(--bad)";
}
function setPromptUI(){
  promptState.textContent = STATE.promptImg ? "已设置" : "未设置";
}
function setQueueUI(){
  qState.textContent = STATE.jobs.length;
  doneState.textContent = STATE.done;
}

function switchMainTab(tab){
  STATE.mainTab = tab;
  document.querySelectorAll(".tabbar .tab").forEach(el=>{
    el.classList.toggle("active", el.dataset.tab===tab);
  });
  panelQueue.style.display = (tab==="queue") ? "block" : "none";
  panelResult.style.display = (tab==="result") ? "block" : "none";
  panelSettings.style.display = (tab==="settings") ? "block" : "none";
  panelExport.style.display = (tab==="export") ? "block" : "none";
}
function switchResultSubTab(tab){
  STATE.resultSubTab = tab;
  renderResultPanel();
}

function renderQueuePanel(){
  setQueueUI();

  const list = STATE.jobs.map((job, idx)=>{
    const st = job.status;
    const stClass = st==="running" ? "running" : (st==="done"?"done": (st==="error"?"err":""));
    const score = job.result?.total_score;
    const ms = (job.startedAt && job.endedAt) ? (job.endedAt - job.startedAt) : null;
    const selected = job.id === STATE.selectedJobId;

    return `
      <div class="card" style="${selected?'border-color: rgba(56,189,248,.55); background: rgba(56,189,248,.08)':''}">
        <div class="row" style="justify-content:space-between">
          <div class="file" title="${escapeHtml(job.name)}">${idx+1}. ${escapeHtml(job.name)}</div>
          <div class="status ${stClass}">${st==="queued"?"排队":st==="running"?"批改中":st==="done"?"完成":"错误"}</div>
        </div>

        <div class="row" style="margin-top:8px; justify-content:space-between">
          <div class="kpi">分数：<b>${(typeof score==="number") ? score : "-"}</b> ｜ 耗时：<b>${ms? (ms/1000).toFixed(1)+"s" : "-"}</b></div>
          <div class="row">
            <button class="btn-ghost btn" onclick="selectJob('${job.id}')">查看</button>
            ${st==="error" ? `<button class="btn-ghost btn" onclick="retryJob('${job.id}')">重试</button>` : ""}
          </div>
        </div>

        ${job.err ? `<div class="hint" style="margin-top:8px; color:var(--bad)">⚠ ${escapeHtml(job.err)}</div>` : ""}
      </div>
    `;
  }).join("");

  panelQueue.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900">队列管理</div>
          <div class="hint" style="margin-top:6px">建议：上传后先点“开始批改”。完成后点“结果”查看更大的分区页面。</div>
        </div>
        <div class="row">
          <button class="btn-ghost btn" onclick="clearQueue()">清空队列</button>
          <button class="btn-ghost btn" onclick="jumpToResult()">去结果页</button>
        </div>
      </div>
    </div>
    ${list || `<div class="hint">还没有上传作文。点击顶部“批量上传作文”。</div>`}
  `;
}

function renderSettingsPanel(){
  const {topic, mode, rubricObj, visionModels, textModels, maxSide, concurrency} = getSettings();
  const rubricText = localStorage.getItem("zp_rubric_v112") || JSON.stringify(rubricObj, null, 2);

  panelSettings.innerHTML = `
    <div class="card">
      <div style="font-weight:900">设置（会影响批改标准）</div>
      <div class="hint" style="margin-top:6px">你可以在这里修改题目、阅卷标准、模型和并发数。</div>
    </div>

    <div class="grid">
      <div class="field">
        <label>作文题目/任务<span class="hint">可选</span></label>
        <input id="setTopic" type="text" value="${escapeHtml(topic)}" placeholder="例：国庆的老家 / 看图写话：扶起摔倒的同学..."/>
      </div>
      <div class="field">
        <label>模式<span class="hint">速度/深度</span></label>
        <select id="setMode">
          <option value="fast" ${mode==="fast"?"selected":""}>极速（更快）</option>
          <option value="std" ${mode==="std"?"selected":""}>标准（推荐）</option>
          <option value="pro" ${mode==="pro"?"selected":""}>精批（更细）</option>
        </select>
      </div>
    </div>

    <div class="grid" style="margin-top:10px">
      <div class="field">
        <label>视觉模型（提取OCR+定位）<span class="hint">视觉不带response_format</span></label>
        <select id="setVision">
          ${["glm-4v-flash","glm-4v","glm-4.6v-flash"].map(m=>`<option value="${m}" ${(visionModels[0]===m)?"selected":""}>${m}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>文本模型（精批/修复）<span class="hint">json_object强约束</span></label>
        <select id="setText">
          ${["glm-4.6","glm-4","glm-4-flash"].map(m=>`<option value="${m}" ${(textModels[0]===m)?"selected":""}>${m}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="grid" style="margin-top:10px">
      <div class="field">
        <label>并发数<span class="hint">1~6</span></label>
        <input id="setConc" type="number" min="1" max="6" value="${concurrency}"/>
        <div class="hint" style="margin-top:6px">建议 2~3（过高可能限流/更慢）</div>
      </div>
      <div class="field">
        <label>压缩尺寸<span class="hint">越小越快</span></label>
        <select id="setMax">
          ${[960,1100,1400].map(v=>`<option value="${v}" ${(maxSide===v)?"selected":""}>${v}</option>`).join("")}
        </select>
        <div class="hint" style="margin-top:6px">作文太糊可选 1400；一般 1100 足够</div>
      </div>
    </div>

    <div class="field" style="margin-top:10px">
      <label>阅卷标准（JSON，可改）<span class="hint">决定四维满分与点评倾向</span></label>
      <textarea id="setRubric">${escapeHtml(rubricText)}</textarea>
      <div class="row" style="margin-top:10px; justify-content:flex-end">
        <button class="btn-ghost btn" onclick="resetRubric()">恢复默认量表</button>
        <button class="btn" onclick="saveSettings()">保存设置</button>
      </div>
      <div class="hint" style="margin-top:8px">注意：量表写错 JSON 会自动用默认量表继续跑。</div>
    </div>
  `;
}

function renderResultPanel(){
  const job = STATE.jobs.find(j=>j.id===STATE.selectedJobId);

  if(!job){
    panelResult.innerHTML = `
      <div class="card">
        <div style="font-weight:900">结果查看</div>
        <div class="hint" style="margin-top:6px">还没有选择作文。去“队列”点一篇“查看”。</div>
      </div>
    `;
    return;
  }

  if(job.status !== "done" || !job.result){
    panelResult.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <div style="font-weight:900">${escapeHtml(job.name)}</div>
            <div class="hint" style="margin-top:6px">状态：${escapeHtml(job.status)}</div>
          </div>
          <div class="row">
            <button class="btn-ghost btn" onclick="switchMainTab('queue')">返回队列</button>
          </div>
        </div>
        <div class="divider"></div>
        <div class="hint">${job.err ? "⚠ "+escapeHtml(job.err) : "尚未完成批改。"}</div>
      </div>
    `;
    return;
  }

  const r = job.result;
  const rub = r.rubric || {};
  const dims = [
    ["内容","content"],
    ["结构","structure"],
    ["语言","language"],
    ["卷面","neatness"]
  ];

  const sub = STATE.resultSubTab;
  const subTabs = [
    ["overview","总览"],
    ["annotations","批注"],
    ["model","范文"],
    ["exercises","练习"],
    ["ocr","OCR"],
    ["raw","原始"]
  ];

  const rubricHtml = `
    <div class="rubric">
      ${dims.map(([label,key])=>{
        const obj = rub[key] || {score:0,max:1,comment:""};
        const pct = obj.max ? Math.max(0, Math.min(100, (obj.score/obj.max)*100)) : 0;
        return `
          <div class="rubItem">
            <div class="rubHead"><span>${label}</span><span style="color:var(--accent)">${obj.score}/${obj.max}</span></div>
            <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
            <div class="rubCmt">${escapeHtml(obj.comment||"")}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  const comment = r.teacher_comment || "";
  const rewrite = r.rewrite || {};
  const improvements = r.improvements || {};
  const modelEssay = r.model_essay || {};
  const exercises = Array.isArray(r.exercises) ? r.exercises : [];
  const annos = Array.isArray(r.annotations) ? r.annotations : [];

  const annoList = annos.map((a,i)=>`
    <div class="anno" onclick="focusAnno(${i})" data-anno="${i}">
      <div class="badge ${a.type==='good'?'good':'err'}">${a.type==='good'?'亮点':'纠错'}</div>
      <div style="flex:1">
        <div>
          <span class="${a.type==='error'?'del':''}">${escapeHtml(a.text||"")}</span>
          ${a.fix ? `<span class="fix">➜ ${escapeHtml(a.fix)}</span>` : ""}
        </div>
        <div class="reason">${escapeHtml(a.reason||"")}</div>
      </div>
    </div>
  `).join("");

  const improvementsHtml = (improvements && typeof improvements==="object") ? `
    <div class="sectionTitle">📌 改进建议</div>
    ${Object.keys(improvements).map(k=>{
      const arr = Array.isArray(improvements[k]) ? improvements[k] : [];
      if(arr.length===0) return "";
      return `
        <div class="hint" style="margin:8px 0 6px"><b style="color:var(--text)">${escapeHtml(k)}</b></div>
        <div class="hint" style="line-height:1.55">
          ${arr.map(x=>`• ${escapeHtml(x)}`).join("<br/>")}
        </div>
      `;
    }).join("")}
  ` : "";

  const overview = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900">${escapeHtml(job.name)}</div>
          <div class="hint" style="margin-top:6px">
            模型：${escapeHtml(r.meta?.vision_model||"-")} / ${escapeHtml(r.meta?.text_model||"-")} ｜ ${escapeHtml(r.meta?.created_at||"")}
          </div>
        </div>
        <div class="row">
          <button class="btn-ghost btn" onclick="printReportCurrent()">🖨 打印/PDF</button>
          <button class="btn-ghost btn" onclick="exportWordCurrent()">📝 Word(.doc)</button>
          <button class="btn-ghost btn" onclick="exportHtmlCurrent()">📄 报告HTML</button>
        </div>
      </div>

      <div class="row" style="gap:14px; align-items:flex-end; margin-top:12px">
        <div class="scoreBig">${r.total_score ?? "-"}</div>
        <div class="hint">总评分（自动校验=四项之和）</div>
      </div>

      ${rubricHtml}

      <div class="sectionTitle">👩‍🏫 名师点评</div>
      <div class="box">${escapeHtml(comment)}</div>

      ${(rewrite?.improved) ? `
        <div class="sectionTitle">✨ 升格润色</div>
        <div class="box">
          <div style="opacity:.75">原句：${escapeHtml(rewrite.original||"")}</div>
          <div style="margin-top:6px; color:var(--primary); font-weight:900">升格：${escapeHtml(rewrite.improved||"")}</div>
          <small>技巧：${escapeHtml(rewrite.technique||"")}</small>
        </div>
      ` : ""}

      ${improvementsHtml}
    </div>
  `;

  const model = `
    <div class="card">
      <div style="font-weight:900">改进范文</div>
      <div class="divider"></div>
      ${modelEssay?.text ? `
        <div class="hint" style="margin-bottom:8px"><b style="color:var(--text)">${escapeHtml(modelEssay.title||"范文")}</b></div>
        <div class="box">${escapeHtml(modelEssay.text||"")}</div>
        ${Array.isArray(modelEssay.highlights) && modelEssay.highlights.length ? `
          <div class="hint" style="margin-top:10px">亮点：${modelEssay.highlights.map(x=>`【${escapeHtml(x)}】`).join(" ")}</div>
        ` : ""}
      ` : `<div class="hint">本次输出未包含范文（可能是极速模式或被截断）。</div>`}
    </div>
  `;

  const ex = `
    <div class="card">
      <div style="font-weight:900">练一练（2题）</div>
      <div class="divider"></div>
      ${exercises.length ? exercises.slice(0,2).map((e,idx)=>`
        <div class="hint" style="margin:8px 0 6px"><b style="color:var(--text)">题${idx+1}：</b>${escapeHtml(e.q||"")}</div>
        <div class="hint">答案：${escapeHtml(e.answer||"")} <span class="pill" style="margin-left:8px">${escapeHtml(e.skill||"")}</span></div>
        <div class="divider"></div>
      `).join("") : `<div class="hint">本次输出未包含练习题（可能是极速模式或被截断）。</div>`}
    </div>
  `;

  const ocr = `
    <div class="card">
      <div style="font-weight:900">OCR 原文</div>
      <div class="divider"></div>
      <div class="hint" style="white-space:pre-wrap; line-height:1.6">${escapeHtml(r.ocr_text||"")}</div>
    </div>
  `;

  const raw = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div style="font-weight:900">原始输出（便于排错）</div>
        <div class="row">
          <button class="btn-ghost btn" onclick="openDebugWithRaw('vision')">视觉原始</button>
          <button class="btn-ghost btn" onclick="openDebugWithRaw('text')">文本原始</button>
        </div>
      </div>
      <div class="divider"></div>
      <div class="hint">点击上方按钮打开调试面板查看。</div>
    </div>
  `;

  const annotations = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900">批注（点击定位）</div>
          <div class="hint" style="margin-top:6px">左侧图片区可拖拽/滚轮缩放；点批注会自动定位。</div>
        </div>
        <div class="row">
          <button class="btn-ghost btn" onclick="drawBoxesForCurrent()">重画框</button>
        </div>
      </div>
      <div class="divider"></div>
      ${annoList || `<div class="hint">没有批注</div>`}
    </div>
  `;

  let body = overview;
  if(sub==="annotations") body = annotations;
  if(sub==="model") body = model;
  if(sub==="exercises") body = ex;
  if(sub==="ocr") body = ocr;
  if(sub==="raw") body = raw;

  panelResult.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900">结果查看（更大视图）</div>
          <div class="hint" style="margin-top:6px">用子选项卡切换：总览/批注/范文/练习/OCR/原始。</div>
        </div>
        <div class="row">
          <button class="btn-ghost btn" onclick="switchMainTab('queue')">返回队列</button>
        </div>
      </div>

      <div class="subtabs">
        ${subTabs.map(([k,label])=>`
          <div class="subtab ${k===STATE.resultSubTab?'active':''}" onclick="switchResultSubTab('${k}')">${label}</div>
        `).join("")}
      </div>
    </div>

    ${body}
  `;
}

function renderExportPanel(){
  panelExport.innerHTML = `
    <div class="card">
      <div style="font-weight:900">导出（离线可用）</div>
      <div class="hint" style="margin-top:6px">
        PDF 采用“打印→保存为PDF”的方式（最稳定且不依赖外部库）。
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900">导出当前选中作文</div>
          <div class="hint" style="margin-top:6px">先到“结果”页选中一篇作文。</div>
        </div>
        <div class="row">
          <button class="btn-ghost btn" onclick="printReportCurrent()">🖨 打印/PDF</button>
          <button class="btn-ghost btn" onclick="exportWordCurrent()">📝 Word(.doc)</button>
          <button class="btn-ghost btn" onclick="exportHtmlCurrent()">📄 报告HTML</button>
          <button class="btn-ghost btn" onclick="exportJsonAll()">⬇ 全部JSON</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900">导出全部合并报告</div>
          <div class="hint" style="margin-top:6px">把所有已完成作文合并到一个HTML中，便于统一打印成PDF。</div>
        </div>
        <div class="row">
          <button class="btn-ghost btn" onclick="exportAllMergedHtml()">📦 合并报告HTML</button>
          <button class="btn-ghost btn" onclick="printAllMerged()">🖨 合并打印/PDF</button>
        </div>
      </div>
    </div>
  `;
}

function renderAll(){
  setKeyUI();
  setPromptUI();
  setQueueUI();

  renderQueuePanel();
  renderSettingsPanel();
  renderExportPanel();
  renderResultPanel();

  // 主Tab显示
  switchMainTab(STATE.mainTab);
}

/** =========================
 *  12. 选择/切换作文
 *  ========================= */
window.selectJob = async (id)=>{
  STATE.selectedJobId = id;
  // 自动跳到结果页
  switchMainTab("result");

  const job = STATE.jobs.find(j=>j.id===id);
  if(job?.essayDataUrl){
    essayImg.src = job.essayDataUrl;
    await new Promise(res=>essayImg.onload=res);
    empty.style.display = "none";
    wrapper.style.display = "block";
    const imgW = essayImg.naturalWidth, imgH = essayImg.naturalHeight;
    initCanvasForImage(imgW, imgH);
    if(job.result?.annotations) drawBoxes(job.result.annotations, imgW, imgH);
    else octx.clearRect(0,0,overlayCanvas.width, overlayCanvas.height);
  }
  renderAll();
};

window.retryJob = (id)=>{
  const job = STATE.jobs.find(j=>j.id===id);
  if(!job) return;
  job.status = "queued";
  job.err = null;
  job.result = null;
  renderAll();
};

window.focusAnno = (idx)=>{
  const job = STATE.jobs.find(j=>j.id===STATE.selectedJobId);
  if(!job?.result?.annotations) return;
  document.querySelectorAll(`[data-anno]`).forEach((el,i)=>{
    el.classList.toggle("active", i===idx);
  });
  const a = job.result.annotations[idx];
  if(a?.pos) showFocus(a.pos);
};

function selectByOffset(offset){
  if(STATE.jobs.length===0) return;
  const idx = STATE.jobs.findIndex(j=>j.id===STATE.selectedJobId);
  const next = (idx===-1) ? 0 : Math.max(0, Math.min(STATE.jobs.length-1, idx+offset));
  selectJob(STATE.jobs[next].id);
}

function jumpToResult(){
  switchMainTab("result");
  renderAll();
}

function clearQueue(){
  if(!confirm("确认清空队列？")) return;
  STATE.jobs = [];
  STATE.selectedJobId = null;
  STATE.done = 0;
  empty.style.display = "block";
  octx.clearRect(0,0,overlayCanvas.width, overlayCanvas.height);
  renderAll();
}

function drawBoxesForCurrent(){
  const job = STATE.jobs.find(j=>j.id===STATE.selectedJobId);
  if(!job?.result?.annotations) return;
  drawBoxes(job.result.annotations, essayImg.naturalWidth, essayImg.naturalHeight);
}

/** =========================
 *  13. 导出：报告 HTML / Word / 打印PDF
 *  ========================= */
function nl2brHtml(s){
  return escapeHtml(s||"").replace(/\n/g,"<br/>");
}

function buildReportHTML(job){
  const r = job.result || {};
  const rub = r.rubric || {};
  const annos = Array.isArray(r.annotations)?r.annotations:[];
  const imp = r.improvements || {};
  const rewrite = r.rewrite || {};
  const modelEssay = r.model_essay || {};
  const exercises = Array.isArray(r.exercises)?r.exercises:[];

  const dimRow = (name, key)=>`
    <tr>
      <td style="padding:6px 8px; border:1px solid #e6e6e6; font-weight:700">${name}</td>
      <td style="padding:6px 8px; border:1px solid #e6e6e6">${rub[key]?.score ?? 0}/${rub[key]?.max ?? ""}</td>
      <td style="padding:6px 8px; border:1px solid #e6e6e6">${escapeHtml(rub[key]?.comment||"")}</td>
    </tr>
  `;

  const impHtml = (imp && typeof imp==="object") ? Object.keys(imp).map(k=>{
    const arr = Array.isArray(imp[k])?imp[k]:[];
    if(!arr.length) return "";
    return `<h4 style="margin:10px 0 6px">${escapeHtml(k)}</h4><ul style="margin:0 0 8px 18px">${arr.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
  }).join("") : "";

  const annoHtml = annos.map(a=>`
    <li style="margin:6px 0">
      <b>${a.type==="good"?"亮点":"纠错"}：</b>
      <span>${escapeHtml(a.text||"")}</span>
      ${a.fix?` <span style="color:#0a7a3b; font-weight:700">➜ ${escapeHtml(a.fix)}</span>`:""}
      <div style="color:#666; font-size:12px; margin-top:2px">理由：${escapeHtml(a.reason||"")}</div>
    </li>
  `).join("");

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>智批报告-${escapeHtml(job.name)}</title>
<style>
  body{font-family: Arial,"Microsoft YaHei",sans-serif; margin:28px; color:#111}
  h1{margin:0 0 8px}
  .meta{color:#555; font-size:12px; margin-bottom:14px}
  .score{font-size:42px; font-weight:900; color:#0077cc; margin:10px 0}
  .box{border-left:4px solid #0077cc; padding:10px 12px; background:#f6fbff; border-radius:8px}
  table{border-collapse:collapse; width:100%; margin:10px 0}
  .sec{margin-top:18px}
  .small{color:#666; font-size:12px}
  .hr{height:1px; background:#e6e6e6; margin:14px 0}
</style>
</head>
<body>
  <h1>智批作文批改报告</h1>
  <div class="meta">
    文件：${escapeHtml(job.name)}<br/>
    时间：${escapeHtml(r.meta?.created_at||"")}<br/>
    模式：${escapeHtml(r.meta?.mode||"")} ｜ 题目：${escapeHtml(r.meta?.topic||"（未提供）")}<br/>
    模型：${escapeHtml(r.meta?.vision_model||"")} / ${escapeHtml(r.meta?.text_model||"")}
  </div>

  <div class="score">总分：${r.total_score ?? "-"}</div>

  <div class="sec">
    <h2>评分细则</h2>
    <table>
      <tr>
        <th style="padding:6px 8px; border:1px solid #e6e6e6; background:#fafafa">维度</th>
        <th style="padding:6px 8px; border:1px solid #e6e6e6; background:#fafafa">得分</th>
        <th style="padding:6px 8px; border:1px solid #e6e6e6; background:#fafafa">点评</th>
      </tr>
      ${dimRow("内容","content")}
      ${dimRow("结构","structure")}
      ${dimRow("语言","language")}
      ${dimRow("卷面","neatness")}
    </table>
  </div>

  <div class="sec">
    <h2>名师点评</h2>
    <div class="box">${nl2brHtml(r.teacher_comment||"")}</div>
  </div>

  ${rewrite?.improved ? `
  <div class="sec">
    <h2>升格润色</h2>
    <div class="box">
      <div><b>原句：</b>${nl2brHtml(rewrite.original||"")}</div>
      <div style="margin-top:6px"><b>升格：</b>${nl2brHtml(rewrite.improved||"")}</div>
      <div class="small" style="margin-top:6px"><b>技巧：</b>${escapeHtml(rewrite.technique||"")}</div>
    </div>
  </div>
  ` : ""}

  ${impHtml ? `
  <div class="sec">
    <h2>改进建议</h2>
    ${impHtml}
  </div>` : ""}

  ${modelEssay?.text ? `
  <div class="sec">
    <h2>改进范文</h2>
    <div class="box">
      <div><b>${escapeHtml(modelEssay.title||"范文")}</b></div>
      <div style="margin-top:8px">${nl2brHtml(modelEssay.text||"")}</div>
      ${Array.isArray(modelEssay.highlights)&&modelEssay.highlights.length ? `<div class="small" style="margin-top:8px">亮点：${modelEssay.highlights.map(x=>`【${escapeHtml(x)}】`).join(" ")}</div>`:""}
    </div>
  </div>
  ` : ""}

  ${exercises.length ? `
  <div class="sec">
    <h2>练一练</h2>
    ${exercises.slice(0,2).map((e,i)=>`
      <div class="box" style="margin-bottom:10px">
        <div><b>题${i+1}：</b>${escapeHtml(e.q||"")}</div>
        <div style="margin-top:6px"><b>答案：</b>${escapeHtml(e.answer||"")} <span class="small">（${escapeHtml(e.skill||"")}）</span></div>
      </div>
    `).join("")}
  </div>` : ""}

  <div class="sec">
    <h2>批注列表</h2>
    <ul style="margin:0 0 0 18px">
      ${annoHtml || "<li>（无）</li>"}
    </ul>
  </div>

  <div class="sec">
    <h2>OCR 原文</h2>
    <div class="box">${nl2brHtml(r.ocr_text||"")}</div>
  </div>

  <div class="hr"></div>
  <div class="small">提示：如需PDF，浏览器打印选择“保存为PDF”。</div>
</body>
</html>`;
}

function getCurrentJobDone(){
  const job = STATE.jobs.find(j=>j.id===STATE.selectedJobId);
  if(!job || job.status!=="done" || !job.result){
    alert("请先在“结果”页选择一篇已完成的作文。");
    return null;
  }
  return job;
}

function exportHtmlCurrent(){
  const job = getCurrentJobDone();
  if(!job) return;
  const html = buildReportHTML(job);
  downloadText(`智批报告_${job.name}.html`, html, "text/html");
}

function exportWordCurrent(){
  const job = getCurrentJobDone();
  if(!job) return;
  const html = buildReportHTML(job);

  // Word 兼容包装（.doc）
  const wordHtml = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>智批报告</title></head>
<body>${html.replace(/^[\s\S]*<body>/i,"").replace(/<\/body>[\s\S]*$/i,"")}</body>
</html>`;
  downloadText(`智批报告_${job.name}.doc`, wordHtml, "application/msword");
}

function printReportCurrent(){
  const job = getCurrentJobDone();
  if(!job) return;
  const html = buildReportHTML(job);
  const w = window.open("", "_blank");
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(()=>w.print(), 400);
}

function exportJsonAll(){
  const rows = STATE.jobs.filter(j=>j.result).map(j=>({file:j.name, id:j.id, ...j.result}));
  if(!rows.length){ alert("没有可导出的结果"); return; }
  downloadText(`智批结果_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`, JSON.stringify(rows,null,2), "application/json");
}

function exportAllMergedHtml(){
  const jobs = STATE.jobs.filter(j=>j.result);
  if(!jobs.length){ alert("没有可导出的结果"); return; }
  const body = jobs.map(j=>buildReportHTML(j).replace(/^[\s\S]*<body>/i,"").replace(/<\/body>[\s\S]*$/i,"")).join("<div style='page-break-after:always'></div>");
  const html = `
<!doctype html><html><head><meta charset="utf-8"/><title>智批合并报告</title></head>
<body>${body}</body></html>`;
  downloadText(`智批合并报告_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.html`, html, "text/html");
}

function printAllMerged(){
  const jobs = STATE.jobs.filter(j=>j.result);
  if(!jobs.length){ alert("没有可打印的结果"); return; }
  const body = jobs.map(j=>buildReportHTML(j).replace(/^[\s\S]*<body>/i,"").replace(/<\/body>[\s\S]*$/i,"")).join("<div style='page-break-after:always'></div>");
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>智批合并报告</title></head><body>${body}</body></html>`;
  const w = window.open("", "_blank");
  w.document.open(); w.document.write(html); w.document.close();
  w.focus();
  setTimeout(()=>w.print(), 500);
}

/** =========================
 *  14. 调试
 *  ========================= */
function openDebugWithRaw(which){
  const job = STATE.jobs.find(j=>j.id===STATE.selectedJobId);
  if(!job) return;
  dbgPanel.style.display = "block";
  dbgReq.textContent = STATE.lastReq ? JSON.stringify(STATE.lastReq,null,2) : "(暂无)";
  dbgRes.textContent = which==="vision" ? (job.rawVision||"(空)") : (job.rawText||"(空)");
}

/** =========================
 *  15. 设置保存
 *  ========================= */
function saveSettings(){
  const topic = $("setTopic").value.trim();
  const mode = $("setMode").value;
  const vision = $("setVision").value;
  const text = $("setText").value;
  const conc = $("setConc").value;
  const max = $("setMax").value;
  const rubricRaw = $("setRubric").value.trim();

  localStorage.setItem("zp_topic_v112", topic);
  localStorage.setItem("zp_mode_v112", mode);
  localStorage.setItem("zp_vision_model_v112", vision);
  localStorage.setItem("zp_text_model_v112", text);
  localStorage.setItem("zp_conc_v112", String(conc));
  localStorage.setItem("zp_imgmax_v112", String(max));

  if(rubricRaw){
    const parsed = safeJsonParse(rubricRaw);
    if(!parsed || !parsed.dims){
      alert("阅卷标准JSON解析失败：已保留旧设置（或恢复默认）。请检查JSON格式。");
    }else{
      localStorage.setItem("zp_rubric_v112", JSON.stringify(parsed,null,2));
    }
  }
  alert("✅ 设置已保存");
  renderAll();
}

function resetRubric(){
  localStorage.setItem("zp_rubric_v112", JSON.stringify(DEFAULT_RUBRIC,null,2));
  renderAll();
}

/** =========================
 *  16. 事件绑定（顶部按钮）
 *  ========================= */
document.querySelectorAll(".tabbar .tab").forEach(el=>{
  el.addEventListener("click", ()=>{
    switchMainTab(el.dataset.tab);
    renderAll();
  });
});

$("btnToggleLeft").onclick = ()=>{
  STATE.leftShown = !STATE.leftShown;
  leftPane.classList.toggle("hidden", !STATE.leftShown);
};

$("btnKey").onclick = ()=>{
  $("keyInput").value = STATE.apiKey || "";
  keyModal.style.display="flex";
};
$("btnKeyCancel").onclick = ()=> keyModal.style.display="none";
$("btnKeySave").onclick = ()=>{
  const k = $("keyInput").value.trim();
  if(!k){ alert("Key不能为空"); return; }
  STATE.apiKey = k;
  sessionStorage.setItem("zp_key_v112", k);
  setKeyUI();
  keyModal.style.display="none";
  renderAll();
};

$("btnPromptImg").onclick = ()=> promptFile.click();
promptFile.onchange = async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  STATE.promptImg = await fileToDataUrl(file);
  setPromptUI();
  alert("✅ 题图已设置（将影响审题与评分）");
  renderAll();
};

$("btnUpload").onclick = ()=> essayFiles.click();
essayFiles.onclick = ()=>{ essayFiles.value=""; };

// === 核心修改：批量上传并自动拼图 ===
essayFiles.onchange = async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  // 1. 分组逻辑 (1.1.jpg, 1.2.jpg)
  const groups = {};
  // 正则含义：匹配开头数字(ID) + 分隔符 + 数字(页码)
  const regex = /^([a-zA-Z0-9\u4e00-\u9fa5]+)([-_.]?)(\d+)\./; 

  for (const f of files) {
    const match = f.name.match(regex);
    let id = f.name; // 默认用文件名
    let page = 1;

    if (match) {
      id = match[1]; // 例如 "1"
      page = parseInt(match[3]); // 例如 1
    }
    
    if (!groups[id]) groups[id] = [];
    groups[id].push({ file: f, page: page, name: f.name });
  }

  // 2. 排序与处理
  // 自然排序ID (1, 2, 10...)
  const sortedIds = Object.keys(groups).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
  let newCount = 0;

  for (const id of sortedIds) {
    const list = groups[id];
    // 按页码排序 (1.1, 1.2)
    list.sort((a,b)=> a.page - b.page);

    // 读取所有图片数据
    const urls = await Promise.all(list.map(x => fileToDataUrl(x.file)));
    
    // 如果有多页，拼图；单页直接用
    const finalUrl = await stitchImages(urls);
    const displayName = list.length > 1 ? `${id} (共${list.length}页)` : list[0].name;

    STATE.jobs.push({
      id: uid(),
      name: displayName,
      essayDataUrl: finalUrl, // 存入拼接后的长图
      status: "queued",
      result: null,
      err: null,
      rawVision: "",
      rawText: "",
      startedAt: null,
      endedAt: null
    });
    newCount++;
  }

  empty.style.display = STATE.jobs.length ? "none" : "block";
  setQueueUI();

  if(!STATE.selectedJobId && STATE.jobs[0]){
    await selectJob(STATE.jobs[0].id);
  }
  
  // 允许重复上传
  essayFiles.value = ""; 
  renderAll();
  
  // 提示
  alert(`成功导入 ${newCount} 份作业（已自动合并多页）`);
};

$("btnStart").onclick = ()=> runQueue();

$("btnDebug").onclick = ()=>{
  dbgPanel.style.display = (dbgPanel.style.display==="block") ? "none" : "block";
  dbgReq.textContent = STATE.lastReq ? JSON.stringify(STATE.lastReq,null,2) : "(暂无)";
  dbgRes.textContent = STATE.lastRes || "(暂无)";
};

$("btnSelectNext").onclick = ()=> selectByOffset(+1);
$("btnSelectPrev").onclick = ()=> selectByOffset(-1);

$("btnCloseDbg").onclick = ()=> dbgPanel.style.display="none";
$("btnCopyReq").onclick = ()=> copyToClipboard(dbgReq.textContent || "");
$("btnCopyRes").onclick = ()=> copyToClipboard(dbgRes.textContent || "");

/** =========================
 *  17. 初始化
 *  ========================= */
function init(){
  // 初始化默认量表（若没有）
  if(!localStorage.getItem("zp_rubric_v112")){
    localStorage.setItem("zp_rubric_v112", JSON.stringify(DEFAULT_RUBRIC,null,2));
  }
  setKeyUI();
  setPromptUI();
  setQueueUI();

  // 默认打开队列页
  switchMainTab("queue");

  if(!STATE.apiKey){
    setTimeout(()=> keyModal.style.display="flex", 450);
  }
  renderAll();
}
init();
