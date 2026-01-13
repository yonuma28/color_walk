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

    const magnifierEl = document.getElementById('magnifier');
    const magnifierCanvas = document.getElementById('magnifierCanvas');

    const trimmingCtx = trimmingCanvas.getContext('2d');
    const cardOutputCtx = cardOutputCanvas.getContext('2d');

    // トリミング表示用Canvasとは別に、画像のみを描くオフスクリーンCanvasを用意（スポイト/拡大鏡の精度向上）
    const imageOnlyCanvas = document.createElement('canvas');
    const imageOnlyCtx = imageOnlyCanvas.getContext('2d');

    const magnifierCtx = magnifierCanvas ? magnifierCanvas.getContext('2d') : null;

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
    const MAG_SIZE = 140;
    const MAG_ZOOM = 4;
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
    imageOnlyCanvas.width = CANVAS_SIZE;
    imageOnlyCanvas.height = CANVAS_SIZE;

    if (magnifierCanvas) {
        magnifierCanvas.width = MAG_SIZE;
        magnifierCanvas.height = MAG_SIZE;
    }
    cardOutputCanvas.width = CARD_WIDTH;
    cardOutputCanvas.height = CARD_HEIGHT;

    // 伝統色データ（color.json から読み込み）
    let TRADITIONAL_COLORS = [];
    let colorsLoaded = false;

    const hashtagInput = document.getElementById('hashtagInput');
    const hashtagOutput = document.getElementById('hashtagOutput');
    const copyBtn = document.getElementById('copyHashtagBtn');

    hashtagInput.addEventListener('input', () => {
        // 1. 入力内容を取得
        const rawValue = hashtagInput.value;
        
        // 2. 改行（\n）で分割して配列にする
        const lines = rawValue.split(/\r?\n/);
        
        // 3. 各行を処理
        const formatted = lines
            .map(line => line.trim())    // 前後の余計な空白を消す
            .filter(line => line !== "") // 中身がある行だけ残す
            .map(line => `#${line} `)    // 先頭に#、末尾に半角空白
            .join("");                   // 全て繋げる
        
        // 4. 右側のエリアに反映
        hashtagOutput.value = formatted;
    });

    // コピー機能（iOS/Android対応）
    copyBtn.addEventListener('click', () => {
        hashtagOutput.select(); // 視覚的に選択状態にする
        navigator.clipboard.writeText(hashtagOutput.value).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = "コピー完了！";
            setTimeout(() => copyBtn.textContent = originalText, 2000);
        });
    });

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
        imageOnlyCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        // 2. 画像を描画（画像のみのCanvasと表示Canvasの両方に反映）
        const drawW = trimRect.originalImgW * trimRect.scale;
        const drawH = trimRect.originalImgH * trimRect.scale;

        imageOnlyCtx.drawImage(originalImage, trimRect.offsetX, trimRect.offsetY, drawW, drawH);
        trimmingCtx.drawImage(imageOnlyCanvas, 0, 0);

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

    function updateExtractedColorAt(x, y) {
        const pixelData = imageOnlyCtx.getImageData(x, y, 1, 1).data;
        const r = pixelData[0];
        const g = pixelData[1];
        const b = pixelData[2];

        extractedRgb = { r, g, b };
        extractedColorSample.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        extractedRgbValue.textContent = `R:${r} G:${g} B:${b}`;
    }

    function finalizeExtractedColorAt(x, y) {
        updateExtractedColorAt(x, y);
        findClosestColorName(extractedRgb.r, extractedRgb.g, extractedRgb.b);
        updateFinalCardPreview();
    }

    function showMagnifier() {
        if (!magnifierEl) return;
        magnifierEl.style.display = 'block';
    }

    function hideMagnifier() {
        if (!magnifierEl) return;
        magnifierEl.style.display = 'none';
    }

    function positionMagnifierByClient(clientX, clientY) {
        if (!magnifierEl) return;
        const rect = trimmingCanvas.getBoundingClientRect();

        // 指に被らないように少しずらす（右上へ）
        const desiredX = (clientX - rect.left) + 18;
        const desiredY = (clientY - rect.top) - 18 - MAG_SIZE;

        const x = Math.max(0, Math.min(rect.width - MAG_SIZE, desiredX));
        const y = Math.max(0, Math.min(rect.height - MAG_SIZE, desiredY));

        magnifierEl.style.left = `${x}px`;
        magnifierEl.style.top = `${y}px`;
    }

    function drawMagnifierAt(canvasX, canvasY) {
        if (!magnifierCtx) return;

        const srcSize = MAG_SIZE / MAG_ZOOM;
        const half = srcSize / 2;
        const sx = Math.max(0, Math.min(CANVAS_SIZE - srcSize, canvasX - half));
        const sy = Math.max(0, Math.min(CANVAS_SIZE - srcSize, canvasY - half));

        magnifierCtx.clearRect(0, 0, MAG_SIZE, MAG_SIZE);
        magnifierCtx.imageSmoothingEnabled = false;
        magnifierCtx.drawImage(imageOnlyCanvas, sx, sy, srcSize, srcSize, 0, 0, MAG_SIZE, MAG_SIZE);

        // 十字（中心を狙いやすくする）
        magnifierCtx.imageSmoothingEnabled = true;
        magnifierCtx.strokeStyle = 'rgba(0,0,0,0.8)';
        magnifierCtx.lineWidth = 1;
        magnifierCtx.beginPath();
        magnifierCtx.moveTo(MAG_SIZE / 2, 0);
        magnifierCtx.lineTo(MAG_SIZE / 2, MAG_SIZE);
        magnifierCtx.moveTo(0, MAG_SIZE / 2);
        magnifierCtx.lineTo(MAG_SIZE, MAG_SIZE / 2);
        magnifierCtx.stroke();
    }

    // スポイト（タッチ/ポインタ対応）
    let isEyedropperActive = false;

    function getEventClientPoint(e) {
        if (e.touches && e.touches.length > 0) return e.touches[0];
        if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0];
        return e;
    }

    function handleEyedropperMove(e) {
        if (!isTrimmingConfirmed || !originalImage || !isEyedropperActive) return;
        if (e.cancelable) e.preventDefault();

        const coords = getCanvasCoordinates(e);
        updateExtractedColorAt(coords.x, coords.y);
        drawMagnifierAt(coords.x, coords.y);

        const pt = getEventClientPoint(e);
        if (pt && typeof pt.clientX === 'number' && typeof pt.clientY === 'number') {
            positionMagnifierByClient(pt.clientX, pt.clientY);
        }
    }

    function handleEyedropperStart(e) {
        if (!isTrimmingConfirmed || !originalImage) return;
        isEyedropperActive = true;
        showMagnifier();
        handleEyedropperMove(e);
    }

    function handleEyedropperEnd(e) {
        if (!isTrimmingConfirmed || !originalImage) return;
        if (e.cancelable) e.preventDefault();

        const coords = getCanvasCoordinates(e);
        finalizeExtractedColorAt(coords.x, coords.y);

        isEyedropperActive = false;
        hideMagnifier();
    }

    function attachEyedropperListeners() {
        if (window.PointerEvent) {
            trimmingCanvas.addEventListener('pointerdown', handleEyedropperStart, { passive: false });
            trimmingCanvas.addEventListener('pointermove', handleEyedropperMove, { passive: false });
            trimmingCanvas.addEventListener('pointerup', handleEyedropperEnd, { passive: false });
            trimmingCanvas.addEventListener('pointercancel', handleEyedropperEnd, { passive: false });
        } else {
            trimmingCanvas.addEventListener('touchstart', handleEyedropperStart, { passive: false });
            trimmingCanvas.addEventListener('touchmove', handleEyedropperMove, { passive: false });
            trimmingCanvas.addEventListener('touchend', handleEyedropperEnd, { passive: false });
            trimmingCanvas.addEventListener('mousedown', handleEyedropperStart);
            trimmingCanvas.addEventListener('mousemove', handleEyedropperMove);
            document.addEventListener('mouseup', handleEyedropperEnd);
        }
    }

    function detachEyedropperListeners() {
        if (window.PointerEvent) {
            trimmingCanvas.removeEventListener('pointerdown', handleEyedropperStart);
            trimmingCanvas.removeEventListener('pointermove', handleEyedropperMove);
            trimmingCanvas.removeEventListener('pointerup', handleEyedropperEnd);
            trimmingCanvas.removeEventListener('pointercancel', handleEyedropperEnd);
        } else {
            trimmingCanvas.removeEventListener('touchstart', handleEyedropperStart);
            trimmingCanvas.removeEventListener('touchmove', handleEyedropperMove);
            trimmingCanvas.removeEventListener('touchend', handleEyedropperEnd);
            trimmingCanvas.removeEventListener('mousedown', handleEyedropperStart);
            trimmingCanvas.removeEventListener('mousemove', handleEyedropperMove);
            document.removeEventListener('mouseup', handleEyedropperEnd);
        }
        hideMagnifier();
        isEyedropperActive = false;
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

    // Pointer Events 用（スマホでのピンチズームを安定させる）
    const activePointers = new Map();
    let panLast = null;
    
    // --- ピンチズーム状態 ---
    let initialPinchDistance = null;
    let pinchStartScale = null;
    let pinchStartOffsetX = null;
    let pinchStartOffsetY = null;
    let pinchStartCenter = null;

    // 2点間の距離を計算する関数
    function getDistance(touches) {
        return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    }

    function getPointerDistance() {
        const pts = Array.from(activePointers.values());
        if (pts.length < 2) return null;
        return Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
    }

    function getPointerCenterCanvas() {
        const pts = Array.from(activePointers.values());
        if (pts.length < 2) return null;
        const centerClientX = (pts[0].clientX + pts[1].clientX) / 2;
        const centerClientY = (pts[0].clientY + pts[1].clientY) / 2;
        return getCanvasCoordinates({ clientX: centerClientX, clientY: centerClientY });
    }

    function handlePointerDown(e) {
        if (!originalImage || isTrimmingConfirmed) return;
        if (e.cancelable) e.preventDefault();

        trimmingCanvas.setPointerCapture?.(e.pointerId);
        activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
        isDragging = true;

        if (activePointers.size === 1) {
            panLast = getCanvasCoordinates(e);
        } else if (activePointers.size === 2) {
            initialPinchDistance = getPointerDistance();
            pinchStartScale = trimRect.scale;
            pinchStartOffsetX = trimRect.offsetX;
            pinchStartOffsetY = trimRect.offsetY;
            pinchStartCenter = getPointerCenterCanvas();
        }

        trimmingCanvas.style.cursor = 'grabbing';
    }

    function handlePointerMove(e) {
        if (!isDragging || !originalImage || isTrimmingConfirmed) return;
        if (!activePointers.has(e.pointerId)) return;
        if (e.cancelable) e.preventDefault();

        activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

        if (activePointers.size === 2) {
            const currentDistance = getPointerDistance();
            if (!initialPinchDistance || !pinchStartScale || !pinchStartCenter || !currentDistance) return;

            const pinchRatio = currentDistance / initialPinchDistance;
            const nextScale = pinchStartScale * pinchRatio;
            const scaleRatio = nextScale / pinchStartScale;
            trimRect.scale = nextScale;
            trimRect.offsetX = pinchStartCenter.x - (pinchStartCenter.x - pinchStartOffsetX) * scaleRatio;
            trimRect.offsetY = pinchStartCenter.y - (pinchStartCenter.y - pinchStartOffsetY) * scaleRatio;
            redrawTrimmingCanvas();
            return;
        }

        if (activePointers.size === 1) {
            const coords = getCanvasCoordinates(e);
            if (panLast) {
                const dx = coords.x - panLast.x;
                const dy = coords.y - panLast.y;
                trimRect.offsetX += dx;
                trimRect.offsetY += dy;
                redrawTrimmingCanvas();
            }
            panLast = coords;
        }
    }

    function handlePointerUp(e) {
        if (!activePointers.has(e.pointerId)) return;
        activePointers.delete(e.pointerId);

        if (activePointers.size < 2) {
            initialPinchDistance = null;
            pinchStartScale = null;
            pinchStartOffsetX = null;
            pinchStartOffsetY = null;
            pinchStartCenter = null;
        }

        if (activePointers.size === 1) {
            // 残った指でそのままパンできるようにする
            const remaining = Array.from(activePointers.values())[0];
            panLast = getCanvasCoordinates({ clientX: remaining.clientX, clientY: remaining.clientY });
        }

        if (activePointers.size === 0) {
            isDragging = false;
            panLast = null;
            trimmingCanvas.style.cursor = 'grab';
            adjustBoundary();
            redrawTrimmingCanvas();
        }
    }

    function handleMouseDown(e) {
        if (!originalImage || isTrimmingConfirmed) return;
        isDragging = true;

        if (e.touches && e.touches.length === 2) {
            // ピンチズーム開始
            initialPinchDistance = getDistance(e.touches);
            pinchStartScale = trimRect.scale;
            pinchStartOffsetX = trimRect.offsetX;
            pinchStartOffsetY = trimRect.offsetY;

            const centerClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const centerClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            pinchStartCenter = getCanvasCoordinates({ clientX: centerClientX, clientY: centerClientY });
        } else {
            // 通常のパン開始
            const coords = getCanvasCoordinates(e);
            lastX = coords.x;
            lastY = coords.y;
        }
        trimmingCanvas.style.cursor = 'grabbing';
    }

    function handleMouseMove(e) {
        if (!isDragging || !originalImage || isTrimmingConfirmed) return;
        if (e.cancelable) e.preventDefault();

        if (e.touches && e.touches.length === 2) {
            const currentDistance = getDistance(e.touches);
            if (!initialPinchDistance || !pinchStartScale || !pinchStartCenter) return;

            const pinchRatio = currentDistance / initialPinchDistance;
            const nextScale = pinchStartScale * pinchRatio;

            // ピンチ中心を固定して拡大縮小（中心点に対する相対位置を維持）
            const scaleRatio = nextScale / pinchStartScale;
            trimRect.scale = nextScale;
            trimRect.offsetX = pinchStartCenter.x - (pinchStartCenter.x - pinchStartOffsetX) * scaleRatio;
            trimRect.offsetY = pinchStartCenter.y - (pinchStartCenter.y - pinchStartOffsetY) * scaleRatio;

            redrawTrimmingCanvas();
        } else if ((e.touches && e.touches.length === 1) || !e.touches) {
            // --- 通常のパン（移動）処理 ---
            const coords = getCanvasCoordinates(e);
            const dx = coords.x - lastX;
            const dy = coords.y - lastY;

            trimRect.offsetX += dx;
            trimRect.offsetY += dy;

            lastX = coords.x;
            lastY = coords.y;
            redrawTrimmingCanvas();
        }
    }

    function handleMouseUp() {
        isDragging = false;
        initialPinchDistance = null;
        pinchStartScale = null;
        pinchStartOffsetX = null;
        pinchStartOffsetY = null;
        pinchStartCenter = null;
        trimmingCanvas.style.cursor = 'grab';
        adjustBoundary();
        redrawTrimmingCanvas();
    }
    
    function handleWheel(e) {
        if (!originalImage || isTrimmingConfirmed) return;
        e.preventDefault();
        
        const scaleChange = (e.deltaY < 0) ? 1.05 : 0.95;

        const rect = trimmingCanvas.getBoundingClientRect();
        const canvasX = ((e.clientX - rect.left) * trimmingCanvas.width) / rect.width;
        const canvasY = ((e.clientY - rect.top) * trimmingCanvas.height) / rect.height;

        trimRect.offsetX -= (canvasX - trimRect.offsetX) * (scaleChange - 1);
        trimRect.offsetY -= (canvasY - trimRect.offsetY) * (scaleChange - 1);
        
        trimRect.scale *= scaleChange;
        
        redrawTrimmingCanvas();
    }

    // --- 座標取得用の補助関数 ---
    function getCanvasCoordinates(e) {
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        const rect = trimmingCanvas.getBoundingClientRect();
        const x = ((clientX - rect.left) * trimmingCanvas.width) / rect.width;
        const y = ((clientY - rect.top) * trimmingCanvas.height) / rect.height;
        return {
            x: Math.max(0, Math.min(trimmingCanvas.width - 1, x)),
            y: Math.max(0, Math.min(trimmingCanvas.height - 1, y))
        };
    }

    // --- リスナー登録の修正 ---
    function attachTrimmingListeners() {
        if (window.PointerEvent) {
            trimmingCanvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
            trimmingCanvas.addEventListener('pointermove', handlePointerMove, { passive: false });
            trimmingCanvas.addEventListener('pointerup', handlePointerUp, { passive: false });
            trimmingCanvas.addEventListener('pointercancel', handlePointerUp, { passive: false });
        } else {
            // マウス
            trimmingCanvas.addEventListener('mousedown', handleMouseDown);
            trimmingCanvas.addEventListener('mousemove', handleMouseMove);
            // タッチ
            trimmingCanvas.addEventListener('touchstart', handleMouseDown, { passive: false });
            trimmingCanvas.addEventListener('touchmove', handleMouseMove, { passive: false });
            trimmingCanvas.addEventListener('touchend', handleMouseUp);
            document.addEventListener('mouseup', handleMouseUp);
        }

        trimmingCanvas.addEventListener('wheel', handleWheel);
        trimmingCanvas.style.cursor = 'grab';
    }

    function detachTrimmingListeners() {
        if (window.PointerEvent) {
            trimmingCanvas.removeEventListener('pointerdown', handlePointerDown);
            trimmingCanvas.removeEventListener('pointermove', handlePointerMove);
            trimmingCanvas.removeEventListener('pointerup', handlePointerUp);
            trimmingCanvas.removeEventListener('pointercancel', handlePointerUp);
            activePointers.clear();
            panLast = null;
        } else {
            trimmingCanvas.removeEventListener('mousedown', handleMouseDown);
            trimmingCanvas.removeEventListener('mousemove', handleMouseMove);
            trimmingCanvas.removeEventListener('touchstart', handleMouseDown);
            trimmingCanvas.removeEventListener('touchmove', handleMouseMove);
            trimmingCanvas.removeEventListener('touchend', handleMouseUp);
            document.removeEventListener('mouseup', handleMouseUp);
        }

        trimmingCanvas.removeEventListener('wheel', handleWheel);
        trimmingCanvas.style.cursor = 'default';
    }

    // --- メインイベントリスナー ---

    // ページ初期化時に色データを読み込み
    loadColorsFromJson();
    
    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            // 前回のスポイト状態をクリア
            try { detachEyedropperListeners(); } catch (_) {}

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

        // スポイト（拡大鏡つき）を有効化
        attachEyedropperListeners();
        trimmingCanvas.style.cursor = 'crosshair';
        spuitInfo.textContent = "画像をタップ/ドラッグして色を抽出します（指を離すと確定）。";
        
        updateFinalCardPreview(); 
    });
    
    cardTitleInput.addEventListener('input', updateFinalCardPreview);
    cardCommentInput.addEventListener('input', updateFinalCardPreview);

    downloadCardBtn.addEventListener('click', async () => {
        if (!finalColorInfo) return;

        const blob = await new Promise((resolve) => cardOutputCanvas.toBlob(resolve, 'image/png'));
        if (!blob) return;

        const fileName = `ColorCard_${finalColorInfo.name}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });

        // --- スマホ向けの共有（写真アプリへ保存導線） ---
        // iOS/Androidの共有シートから「写真に保存」「画像を保存」等を選べます
        if (navigator.share) {
            try {
                if (!navigator.canShare || navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: '色抽出カード',
                        text: '色抽出カードを作成しました。'
                    });
                    return;
                }
            } catch (err) {
                console.error('Share failed:', err);
            }
        }

        // フォールバック：通常ダウンロード（環境によっては新規タブで開いて保存）
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.target = '_blank';
        a.rel = 'noopener';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    // 初期化時
    trimmingCanvas.addEventListener('click', (e) => {
        if (!originalImage) alert("先に画像をアップロードしてください。");
    });
});