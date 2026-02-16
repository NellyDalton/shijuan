    // === 核心数据 ===
    // 存储结构: { "1": [blob1, blob2], "2": [blob1], ... }
    let allData = {}; 
    let studentId = 1;
    let currentBatch = []; // 当前正在拍的这个学生的照片

    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const btnExport = document.getElementById('btnExport');
    const btnUndoLast = document.getElementById('btnUndoLast');
    const btnSnap = document.getElementById('btnSnap');
    const btnNextStudent = document.getElementById('btnNextStudent');
    const previewBox = document.getElementById('previewBox');
    const previewImg = document.getElementById('previewImg');
    const previewBadge = document.getElementById('previewBadge');
    const totalSaved = document.getElementById('totalSaved');
    const memUsage = document.getElementById('memUsage');
    const currId = document.getElementById('currId');
    const currPage = document.getElementById('currPage');

    let previewUrl = null;

    // 1. 初始化相机
    async function init() {
        try {
            // 优先尝试高清后置
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1440 } } 
            });
            video.srcObject = stream;
        } catch (e) {
            alert("无法启动相机。请使用 Safari (iOS) 或 Chrome (Android)，并确保网址是 HTTPS 或 file://");
        }
    }
    init();

    // 2. 拍照 (自动压缩防止内存溢出)
    function snap() {
        if (!video.videoWidth) return;
        
        // 闪光动画
        const f = document.getElementById('flash');
        f.style.opacity = 0.8; setTimeout(()=>f.style.opacity=0, 150);

        // 限制尺寸：最大边长 1600px (约 200万像素)，既清晰又省内存
        const maxSide = 1600;
        let w = video.videoWidth;
        let h = video.videoHeight;
        if (w > maxSide || h > maxSide) {
            const r = Math.min(maxSide/w, maxSide/h);
            w *= r; h *= r;
        }

        canvas.width = w;
        canvas.height = h;
        
        // 简单增强
        ctx.filter = "contrast(1.1) brightness(1.05)";
        ctx.drawImage(video, 0, 0, w, h);

        // 存为 Blob (0.8质量)
        canvas.toBlob(blob => {
            currentBatch.push(blob);
            updateUI();
        }, 'image/jpeg', 0.8);
    }

    // 3. 撤销上一页
    function undoLast() {
        if (currentBatch.length === 0) return;
        currentBatch.pop();
        updateUI();
    }

    // 4. 下一位 (存入内存，不下载)
    function nextStudent() {
        if (currentBatch.length === 0) {
            // 误触保护
            if(!confirm("当前学生还没拍照，确定要跳过吗？")) return;
        }

        // 保存到大对象
        if(currentBatch.length > 0) {
            allData[studentId] = [...currentBatch];
        }
        
        // 简单的成功反馈
        const hud = document.querySelector('.current-hud');
        const oldText = hud.innerHTML;
        hud.innerHTML = `✅ 学生 ${studentId} 已保存`;
        hud.style.background = "rgba(16, 185, 129, 0.6)";
        
        setTimeout(() => {
            studentId++;
            currentBatch = [];
            hud.innerHTML = `当前: 学生 <span id="currId" style="font-size:1.3em; color:#fff">${studentId}</span> (第 <span id="currPage">0</span> 页)`;
            hud.style.background = ""; // 恢复样式
            updateUI();
        }, 500);
    }

    // 5. 最终导出
    function exportAll() {
        // 检查：如果当前学生拍了一半没点“下一位”，询问是否包含
        if (currentBatch.length > 0) {
            if(confirm(`检测到“学生 ${studentId}”还有照片未归档，要一起打包吗？`)) {
                allData[studentId] = [...currentBatch];
            } else {
                return; // 用户取消
            }
        }

        const ids = Object.keys(allData);
        if (ids.length === 0) return alert("还没有任何数据！");

        // 显示加载层
        document.getElementById('loading').style.display = 'flex';

        const zip = new JSZip();
        
        // 遍历打包
        ids.forEach(sid => {
            const pages = allData[sid];
            pages.forEach((blob, idx) => {
                // 自动命名：1.1.jpg, 1.2.jpg (改卷端能自动识别)
                zip.file(`${sid}.${idx + 1}.jpg`, blob);
            });
        });

        // 生成文件
        zip.generateAsync({type:"blob"}).then(content => {
            document.getElementById('loading').style.display = 'none';
            
            const date = new Date();
            const timeStr = `${date.getHours()}点${date.getMinutes()}分`;
            saveAs(content, `全班作业_${ids.length}人_${timeStr}.zip`);
            
            // 导出成功后提示
            if(confirm("✅ 导出成功！\n\n是否清空所有已拍数据，准备扫描新的班级？")) {
                location.reload();
            }
        });
    }

    // UI更新
    function updateUI() {
        // 更新顶部统计
        const savedCount = Object.keys(allData).length;
        totalSaved.innerText = savedCount;
        
        // 估算内存: 假设每张图 0.4MB
        let totalPages = currentBatch.length;
        Object.values(allData).forEach(arr => totalPages += arr.length);
        const mem = (totalPages * 0.4).toFixed(1);
        memUsage.innerText = mem;
        
        // 内存警告 (超过300MB变红)
        const stats = document.querySelector('.stats');
        if (mem > 300) stats.style.color = "#fb7185";
        else stats.style.color = "#aaa";

        // 启用导出按钮
        btnExport.disabled = (savedCount === 0 && currentBatch.length === 0);

        // 更新中间HUD
        if(currId) currId.innerText = studentId;
        if(currPage) currPage.innerText = currentBatch.length;

        // 更新预览图
        if (currentBatch.length > 0) {
            previewBox.style.display = 'block';
            const lastBlob = currentBatch[currentBatch.length-1];
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = URL.createObjectURL(lastBlob);
            previewImg.src = previewUrl;
            previewBadge.innerText = `${currentBatch.length}页`;
        } else {
            previewBox.style.display = 'none';
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
                previewUrl = null;
                previewImg.removeAttribute('src');
            }
        }
    }

    btnExport.addEventListener('click', exportAll);
    btnUndoLast.addEventListener('click', undoLast);
    btnSnap.addEventListener('click', snap);
    btnNextStudent.addEventListener('click', nextStudent);

    // 防误触刷新
    window.onbeforeunload = function() {
        if (Object.keys(allData).length > 0 || currentBatch.length > 0) {
            return "数据未导出，确定要刷新吗？";
        }
    };
