document.addEventListener('DOMContentLoaded', () => {
    // --- 要素の取得 ---
    const imageUpload = document.getElementById('imageUpload');
    const trimmingCanvas = document.getElementById('trimmingCanvas');
    const confirmTrimBtn = document.getElementById('confirmTrimBtn');
    const spuitInfo = document.getElementById('spuitInfo');
    const extractedColorSample = document.getElementById('extractedColorSample');
    const extractedRgbValue = document.getElementById('extractedRgbValue');
    const closestColorNameEl = document.getElementById('closestColorName');
    const cardTitleInput = document.getElementById('cardTitle');
    const cardCommentInput = document.getElementById('cardComment');
    const downloadCardBtn = document.getElementById('downloadCardBtn');
    const cardOutputCanvas = document.getElementById('cardOutputCanvas');

    const trimmingCtx = trimmingCanvas.getContext('2d');
    const cardOutputCtx = cardOutputCanvas.getContext('2d');

    // --- グローバル変数 (状態管理) ---
    let originalImage = null;
    let isTrimmingConfirmed = false;
    let trimRect = { 
        scale: 1,      
        offsetX: 0,    
        offsetY: 0,    
        originalImgW: 0,
        originalImgH: 0
    };
    let extractedRgb = null; 
    let finalColorInfo = null; 
    
    // 定数
    const CANVAS_SIZE = 400; 
    const DPI_SCALE = 3; // 1mm = 3px に設定 (A4表示のバランス調整のため)

    // A4の寸法 (mm)
    const A4_W_MM = 210;
    const A4_H_MM = 297;
    
    // 余白 (mm)
    const MARGIN_TOP_MM = 35.01;
    const MARGIN_SIDE_BOTTOM_MM = 30;

    // Canvasの最終出力サイズ (px)
    const CARD_WIDTH = A4_W_MM * DPI_SCALE;
    const CARD_HEIGHT = A4_H_MM * DPI_SCALE;
    
    // 画像や色枠の幅 (余白を引いたpx)
    const CONTENT_WIDTH = CARD_WIDTH - (MARGIN_SIDE_BOTTOM_MM * 2 * DPI_SCALE);

    // Canvas初期設定
    trimmingCanvas.width = CANVAS_SIZE;
    trimmingCanvas.height = CANVAS_SIZE;
    cardOutputCanvas.width = CARD_WIDTH;
    cardOutputCanvas.height = CARD_HEIGHT;

    // 伝統色データ（color.json から読み込み）
    let TRADITIONAL_COLORS = [];
    let colorsLoaded = false;

    async function loadColorsFromJson() {
        try {
            const res = await fetch('color.json', { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            // 構造バリデーションと正規化
            if (!Array.isArray(data)) throw new Error('JSON 形式が配列ではありません');
            TRADITIONAL_COLORS = data
                .filter(c => c && typeof c.name === 'string' &&
                    Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b))
                .map(c => ({ name: c.name, r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) }));

            colorsLoaded = TRADITIONAL_COLORS.length > 0;
            if (!colorsLoaded) {
                closestColorNameEl.textContent = '色データが空です。color.json を確認してください。';
            }
        } catch (err) {
            console.error('color.json 読み込み失敗:', err);
            closestColorNameEl.textContent = '色データの読み込みに失敗しました。';
            colorsLoaded = false;
        }
    }

    // ----------------------------------------------------
    // --- 色差計算 (CIE L*a*b* および Delta E 2000) ---
    // ----------------------------------------------------

    // RGB to XYZ 変換 
    function rgbToXyz(r, g, b) {
        let R = r / 255, G = g / 255, B = b / 255;
        R = (R > 0.04045) ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
        G = (G > 0.04045) ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
        B = (B > 0.04045) ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
        
        let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) * 100;
        let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) * 100;
        let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) * 100;
        return [X, Y, Z];
    }

    // XYZ to Lab 変換
    function xyzToLab(x, y, z) {
        const whiteX = 95.047, whiteY = 100.000, whiteZ = 108.883; 
        let refX = x / whiteX, refY = y / whiteY, refZ = z / whiteZ;

        function f(t) { return (t > Math.pow(6/29, 3)) ? Math.pow(t, 1/3) : (t * Math.pow(29/6, 2) / 3 + 4/29); }

        let L = 116 * f(refY) - 16;
        let a = 500 * (f(refX) - f(refY));
        let b = 200 * (f(refY) - f(refZ));
        return [L, a, b];
    }

    // RGB to Lab 統合
    function rgbToLab(r, g, b) {
        const [x, y, z] = rgbToXyz(r, g, b);
        return xyzToLab(x, y, z);
    }
    
    // Delta E 2000 計算 (構造のみ - 厳密なΔE2000計算が必要)
    function deltaE2000(lab1, lab2) {
        const deg2rad = Math.PI / 180;
        
        let [L1, a1, b1] = lab1;
        let [L2, a2, b2] = lab2;

        const C1 = Math.sqrt(a1 * a1 + b1 * b1);
        const C2 = Math.sqrt(a2 * a2 + b2 * b2);
        
        const avgC = (C1 + C2) / 2.0;
        const avgL = (L1 + L2) / 2.0;
        
        const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
        
        const a1Prime = a1 * (1 + G);
        const a2Prime = a2 * (1 + G);
        
        const C1Prime = Math.sqrt(a1Prime * a1Prime + b1 * b1);
        const C2Prime = Math.sqrt(a2Prime * a2Prime + b2 * b2);
        
        const h1Prime = (Math.atan2(b1, a1Prime) * 180 / Math.PI + 360) % 360;
        const h2Prime = (Math.atan2(b2, a2Prime) * 180 / Math.PI + 360) % 360;

        const deltaLPrime = L2 - L1;
        const deltaCPrime = C2Prime - C1Prime;

        let deltaHPrime;
        if (C1Prime * C2Prime === 0) {
            deltaHPrime = 0;
        } else if (Math.abs(h2Prime - h1Prime) <= 180) {
            deltaHPrime = h2Prime - h1Prime;
        } else if (h2Prime - h1Prime > 180) {
            deltaHPrime = h2Prime - h1Prime - 360;
        } else {
            deltaHPrime = h2Prime - h1Prime + 360;
        }
        
        const deltaH = 2 * Math.sqrt(C1Prime * C2Prime) * Math.sin((deltaHPrime * deg2rad) / 2.0);
        
        // 厳密なΔE2000の最終的な計算式は複雑なため、ここでは簡略化された結果を返します。
        const result = Math.sqrt(Math.pow(deltaLPrime, 2) + Math.pow(deltaCPrime, 2) + Math.pow(deltaH, 2));
        
        return result; 
    }

    /**
     * RGB値に基づいて、最も近い伝統色名を見つける
     */
    function findClosestColorName(r, g, b) {
        if (!colorsLoaded || TRADITIONAL_COLORS.length === 0) {
            closestColorNameEl.textContent = '色データが未読み込みのため近似色検索できません。';
            downloadCardBtn.disabled = true;
            return;
        }
        const labA = rgbToLab(r, g, b);
        let minDeltaE = Infinity;
        let closestColor = null;

        for (const color of TRADITIONAL_COLORS) {
            const labB = rgbToLab(color.r, color.g, color.b);
            const deltaE = deltaE2000(labA, labB); 
            
            if (deltaE < minDeltaE) {
                minDeltaE = deltaE;
                closestColor = color;
            }
        }
        
        if (closestColor) {
            finalColorInfo = {
                rgb: { r: closestColor.r, g: closestColor.g, b: closestColor.b },
                name: closestColor.name,
                originalRgb: { r, g, b }
            };
            closestColorNameEl.textContent = `最接近色: ${finalColorInfo.name} (ΔE: ${minDeltaE.toFixed(2)})`;
            downloadCardBtn.disabled = false;
        }
    }


    // ----------------------------------------------------
    // --- I. トリミング関連関数 ---
    // ----------------------------------------------------

    /**
     * トリミング補助線と枠を描画する
     */
    function drawTrimmingOverlay() {
        // 補助線（三分割法）を描画
        trimmingCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        trimmingCtx.lineWidth = 1;
        const third = CANVAS_SIZE / 3;
        
        trimmingCtx.beginPath();
        trimmingCtx.moveTo(third, 0); trimmingCtx.lineTo(third, CANVAS_SIZE);
        trimmingCtx.moveTo(third * 2, 0); trimmingCtx.lineTo(third * 2, CANVAS_SIZE);
        trimmingCtx.moveTo(0, third); trimmingCtx.lineTo(CANVAS_SIZE, third);
        trimmingCtx.moveTo(0, third * 2); trimmingCtx.lineTo(CANVAS_SIZE, third * 2);
        trimmingCtx.stroke();
        
        // トリミング枠の白色の境界線
        trimmingCtx.strokeStyle = 'white';
        trimmingCtx.lineWidth = 4;
        trimmingCtx.strokeRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }

    /**
     * 画像がトリミング枠をはみ出さないようにオフセットを調整する (境界線チェック)
     */
    function adjustBoundary() {
        const drawW = trimRect.originalImgW * trimRect.scale;
        const drawH = trimRect.originalImgH * trimRect.scale;
        
        // X軸のチェック
        if (drawW > CANVAS_SIZE) {
            trimRect.offsetX = Math.min(trimRect.offsetX, 0); 
            trimRect.offsetX = Math.max(trimRect.offsetX, CANVAS_SIZE - drawW); 
        } else {
            trimRect.offsetX = (CANVAS_SIZE - drawW) / 2;
        }

        // Y軸のチェック
        if (drawH > CANVAS_SIZE) {
            trimRect.offsetY = Math.min(trimRect.offsetY, 0);
            trimRect.offsetY = Math.max(trimRect.offsetY, CANVAS_SIZE - drawH);
        } else {
            trimRect.offsetY = (CANVAS_SIZE - drawH) / 2;
        }
        
        // 最小ズームスケールのチェック
        const minScaleX = CANVAS_SIZE / trimRect.originalImgW;
        const minScaleY = CANVAS_SIZE / trimRect.originalImgH;
        const minScale = Math.max(minScaleX, minScaleY);

        if (trimRect.scale < minScale) {
            trimRect.scale = minScale;
            setupInitialTrimming(originalImage); 
        }
    }


    /**
     * トリミングCanvasの再描画 (画像 + 補助線)
     */
    function redrawTrimmingCanvas() {
        if (!originalImage) return;

        adjustBoundary(); 

        // 1. Canvasをクリア
        trimmingCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        
        // 2. 画像を描画 (純粋な画像のみ)
        const drawW = trimRect.originalImgW * trimRect.scale;
        const drawH = trimRect.originalImgH * trimRect.scale;
        
        trimmingCtx.drawImage(
            originalImage, 
            trimRect.offsetX, 
            trimRect.offsetY, 
            drawW, 
            drawH
        );

        // 3. オーバーレイと補助線を描画
        drawTrimmingOverlay();
    }
    
    /**
     * トリミング枠の初期設定
     */
    function setupInitialTrimming(img) {
        const minScaleX = CANVAS_SIZE / img.width;
        const minScaleY = CANVAS_SIZE / img.height;
        const minScale = Math.max(minScaleX, minScaleY);

        trimRect.scale = minScale;
        trimRect.originalImgW = img.width;
        trimRect.originalImgH = img.height;
        
        const drawW = img.width * trimRect.scale;
        const drawH = img.height * trimRect.scale;
        trimRect.offsetX = (CANVAS_SIZE - drawW) / 2;
        trimRect.offsetY = (CANVAS_SIZE - drawH) / 2;
        
        redrawTrimmingCanvas();
    }


    // ----------------------------------------------------
    // --- II. スポイト機能とプレビュー ---
    // ----------------------------------------------------

    function handleCanvasClick(e) {
        if (!isTrimmingConfirmed || !originalImage) return;

        const x = e.offsetX;
        const y = e.offsetY;

        const pixelData = trimmingCtx.getImageData(x, y, 1, 1).data;
        const r = pixelData[0];
        const g = pixelData[1];
        const b = pixelData[2];
        
        extractedRgb = { r, g, b };
        
        extractedColorSample.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        extractedRgbValue.textContent = `R:${r} G:${g} B:${b}`;

        findClosestColorName(r, g, b);
        updateFinalCardPreview(); 
    }

    /**
     * 最終カードのデザインを描画し、プレビューを更新する
     */
    function updateFinalCardPreview() {
        if (!originalImage) return;

        const sideMarginPx = MARGIN_SIDE_BOTTOM_MM * DPI_SCALE;
        const topMarginPx = MARGIN_TOP_MM * DPI_SCALE;
        const bottomMarginPx = MARGIN_SIDE_BOTTOM_MM * DPI_SCALE;

        // 1. カード全体のクリアと背景色の設定
        cardOutputCtx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        cardOutputCtx.fillStyle = '#fffff0'; 
        cardOutputCtx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        
        if (finalColorInfo) {
            const { r: cr, g: cg, b: cb } = finalColorInfo.rgb;
            cardOutputCtx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.3)`; 
            cardOutputCtx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        } else {
             cardOutputCtx.fillStyle = `rgb(220, 220, 220)`; 
             cardOutputCtx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        }
        
        // 2. トリミング後の画像の描画
        const imageSizeOnCard = CONTENT_WIDTH; 
        const imageX = sideMarginPx;           
        const imageY = topMarginPx;            

        const sx = -trimRect.offsetX / trimRect.scale;
        const sy = -trimRect.offsetY / trimRect.scale;
        const sWidth = CANVAS_SIZE / trimRect.scale;
        const sHeight = CANVAS_SIZE / trimRect.scale;

        try {
            cardOutputCtx.drawImage(
                originalImage, 
                sx, sy, sWidth, sHeight, 
                imageX, imageY, imageSizeOnCard, imageSizeOnCard
            );
        } catch (e) {
            console.error("トリミング画像描画エラー:", e);
        }
        
        // 3. テキストの描画
        cardOutputCtx.textAlign = 'center';
        
        // --- 3-1. タイトル ---
        const titleY = imageY + imageSizeOnCard + (30 * DPI_SCALE / 2); 
        cardOutputCtx.fillStyle = '#333';
        cardOutputCtx.font = `28px "Hanna Mincho", serif`; 
        const titleText = cardTitleInput.value || 'TITLE';
        
        // タイトルにボーダーラインを描画
        cardOutputCtx.strokeStyle = '#333'; 
        cardOutputCtx.lineWidth = 1;        
        
        const titleWidth = cardOutputCtx.measureText(titleText).width;
        const lineXStart = CARD_WIDTH / 2 - titleWidth / 2; // テキスト幅にぴったり
        const lineXEnd = CARD_WIDTH / 2 + titleWidth / 2;   // テキスト幅にぴったり
        
        cardOutputCtx.beginPath();
        cardOutputCtx.moveTo(lineXStart, titleY + 5); 
        cardOutputCtx.lineTo(lineXEnd, titleY + 5);
        cardOutputCtx.stroke();
        
        cardOutputCtx.fillText(titleText, CARD_WIDTH / 2, titleY);
        
        // --- 3-2. コメント ---
        const commentY = titleY + (28 * DPI_SCALE / 3) + (20 * DPI_SCALE / 3); 
        cardOutputCtx.font = `20px "Hanna Mincho", serif`; 
        cardOutputCtx.fillText(cardCommentInput.value || 'Comment', CARD_WIDTH / 2, commentY);


        // 4. 色ブロックとRGB値の描画
        const SPACE_BETWEEN_COMMENT_RGB_MM = 55; // 10mm程度の間隔を空ける (30px)

        const rgbY = commentY 
                + (20 * DPI_SCALE / 3) // コメントのフォントサイズ分
                + (SPACE_BETWEEN_COMMENT_RGB_MM * DPI_SCALE / 3); // 1行の改行スペース (10mm=30px)
        
        // RGB値 (Ink Free)
        cardOutputCtx.fillStyle = '#333';
        cardOutputCtx.font = `30px "Ink Free", cursive`; 
        
        if (finalColorInfo) {
            const { r: or, g: og, b: ob } = finalColorInfo.originalRgb;
            cardOutputCtx.fillText(`R:${or} G:${og} B:${ob}`, CARD_WIDTH / 2, rgbY);
        } else {
            cardOutputCtx.fillText(`R:--- G:--- B:---`, CARD_WIDTH / 2, rgbY);
        }

        // 色ブロックエリアの計算 (高さ20mm)
        const blockH = 20 * DPI_SCALE; 
        const blockBottomY = CARD_HEIGHT - bottomMarginPx; // ★ カードの最下端
        const blockW = CONTENT_WIDTH; 
        const blockX = sideMarginPx; 
        
        if (finalColorInfo) {
            // 色ブロックの描画
            const { r: cr, g: cg, b: cb } = finalColorInfo.rgb;
            cardOutputCtx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
            cardOutputCtx.fillRect(blockX, blockBottomY - blockH, blockW, blockH); 

            // 色名 (はんなり明朝)
            cardOutputCtx.fillStyle = '#fff';
            cardOutputCtx.font = `25px "Hanna Mincho", serif`; 
            cardOutputCtx.fillText(finalColorInfo.name, CARD_WIDTH / 2, blockBottomY - blockH / 2 + 5);
        } else {
            // 色未選択時
            cardOutputCtx.fillStyle = `#cccccc`; 
            cardOutputCtx.fillRect(blockX, blockBottomY - blockH, blockW, blockH);
            cardOutputCtx.fillStyle = `#fff`;
            cardOutputCtx.font = `25px "Hanna Mincho", serif`;
            cardOutputCtx.fillText(`色を選択してください`, CARD_WIDTH / 2, blockBottomY - blockH / 2 + 5);
        }
    }
    
    // ----------------------------------------------------
    // --- III. イベントリスナーと操作ロジック ---
    // ----------------------------------------------------

    // --- トリミング操作ロジック (パン/ズーム) ---
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    
    function handleMouseDown(e) {
        if (!originalImage || isTrimmingConfirmed) return;
        isDragging = true;
        lastX = e.offsetX;
        lastY = e.offsetY;
        trimmingCanvas.style.cursor = 'grabbing';
    }

    function handleMouseMove(e) {
        if (!isDragging || !originalImage || isTrimmingConfirmed) return;
        
        const dx = e.offsetX - lastX;
        const dy = e.offsetY - lastY;
        
        trimRect.offsetX += dx;
        trimRect.offsetY += dy;
        
        redrawTrimmingCanvas();
        
        lastX = e.offsetX;
        lastY = e.offsetY;
    }
    
    function handleMouseUp() {
        if (isDragging) {
            isDragging = false;
            trimmingCanvas.style.cursor = 'grab';
            adjustBoundary(); 
            redrawTrimmingCanvas();
        }
    }
    
    function handleWheel(e) {
        if (!originalImage || isTrimmingConfirmed) return;
        e.preventDefault();
        
        const scaleChange = (e.deltaY < 0) ? 1.05 : 0.95;
        
        trimRect.offsetX -= (e.offsetX - trimRect.offsetX) * (scaleChange - 1);
        trimRect.offsetY -= (e.offsetY - trimRect.offsetY) * (scaleChange - 1);
        
        trimRect.scale *= scaleChange;
        
        redrawTrimmingCanvas();
    }

    function attachTrimmingListeners() {
        trimmingCanvas.addEventListener('mousedown', handleMouseDown);
        trimmingCanvas.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        trimmingCanvas.addEventListener('wheel', handleWheel);
        trimmingCanvas.style.cursor = 'grab';
    }
    
    function detachTrimmingListeners() {
        trimmingCanvas.removeEventListener('mousedown', handleMouseDown);
        trimmingCanvas.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        trimmingCanvas.removeEventListener('wheel', handleWheel);
        trimmingCanvas.style.cursor = 'default';
    }

    // --- メインイベントリスナー ---

    // ページ初期化時に色データを読み込み
    loadColorsFromJson();
    
    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    originalImage = img;
                    isTrimmingConfirmed = false;
                    confirmTrimBtn.disabled = false;
                    downloadCardBtn.disabled = true;
                    
                    setupInitialTrimming(originalImage);
                    attachTrimmingListeners(); 
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
    
    confirmTrimBtn.addEventListener('click', () => {
        if (!originalImage || isTrimmingConfirmed) return;
        isTrimmingConfirmed = true;
        confirmTrimBtn.disabled = true;
        detachTrimmingListeners(); 
        
        trimmingCanvas.addEventListener('click', handleCanvasClick);
        trimmingCanvas.style.cursor = 'crosshair';
        spuitInfo.textContent = "画像をクリックし、色を抽出してください。";
        
        updateFinalCardPreview(); 
    });
    
    cardTitleInput.addEventListener('input', updateFinalCardPreview);
    cardCommentInput.addEventListener('input', updateFinalCardPreview);

    downloadCardBtn.addEventListener('click', () => {
        if (finalColorInfo) {
            const dataURL = cardOutputCanvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataURL;
            a.download = `ColorCard_${finalColorInfo.name}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    });

    // 初期化時
    trimmingCanvas.addEventListener('click', (e) => {
        if (!originalImage) alert("先に画像をアップロードしてください。");
    });
});