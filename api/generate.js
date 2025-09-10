// 引入 Google AI 的官方 Node.js 函式庫
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Vercel 伺服器函式的標準寫法
export default async function handler(req, res) {
    // 只接受 POST 方法的請求
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '僅允許 POST 方法' });
    }

    try {
        // 從前端請求的 body 中獲取所有資料
        const { storyIdea, character, setting, style, uploadedImageBase64 } = req.body;
        
        // **安全性:** 從伺服器環境變數中讀取 API 金鑰
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

        // --- 1. 生成劇本 ---
        const scriptGenModel = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash-latest",
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ]
        });

        // 為了簡潔，此處省略了完整的 system prompt，但後端仍會使用完整的版本
        const systemPrompt = `你是一位專門為繁體中文讀者創作漫畫的AI編劇。你的核心任務是將中文創意轉化為漫畫劇本。**最重要的規則：**- **對白 (\`dialogue\`) 欄位：** 內容【只能】是繁體中文。絕對禁止任何英文字母或單詞。- **繪圖指令 (\`image_prompt\`) 欄位：** 內容【只能】是英文，以便圖像模型理解。你的輸出【必須】是單一的、沒有任何註解的 JSON 物件。在生成 \`image_prompt\` 時，你必須嚴格遵守以下順序與規則：1. **【角色優先原則】**: 將使用者提供的【角色設定】完整翻譯成英文，並將這段描述放在每一格 \`image_prompt\` 的最前面。這是確保角色一致性的最高指令，絕不可以省略或修改。2. **【場景與動作】**: 在角色描述之後，再加入當前畫格的場景和動作描述。3. **【風格與附加項】**: 最後，加上使用者選擇的【漫畫風格】以及 \`, no text, textless, no words, clean art\` 這段防止亂碼的指令。**範例格式**: \`image_prompt: "[角色設定的英文翻譯], [場景與動作描述], [漫畫風格], no text, textless..."\`**輸出前請再次檢查，確保所有 \`dialogue\` 都是繁體中文，且每一格的 \`image_prompt\` 都以角色描述為開頭。`;
        const userInput = `【故事核心】: "${storyIdea}"\n【角色設定】: "${character}"\n【場景設定】: "${setting}"\n【漫畫風格】: "${style}"`;
        
        const scriptResult = await scriptGenModel.generateContent({
            contents: [{ role: "user", parts: [{ text: userInput }] }],
            generationConfig: { responseMimeType: "application/json" },
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
        });

        let script = JSON.parse(scriptResult.response.text());
        
        // 驗證並修正劇本格式
        if (script) {
            if (script.panels && Array.isArray(script.panels)) {} 
            else if (script.comic_panels && Array.isArray(script.comic_panels)) { script.panels = script.comic_panels; }
            else if (script.comic_script && Array.isArray(script.comic_script)) { script.panels = script.comic_script; } 
            else if (typeof script === 'object' && !Array.isArray(script) && script.panel1) { script = { panels: Object.values(script) }; }
        }
        if (!script || !script.panels || !Array.isArray(script.panels) || script.panels.length === 0) {
            throw new Error("AI 未能生成有效的漫畫劇本。");
        }

        // --- 2. 生成圖片 ---
        const imageGenModel = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash-latest",
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ]
        });
        
        const panelImages = [];
        for (const panel of script.panels) {
            const prompt = panel.image_prompt;
            const parts = [{ text: "" }];

            if (uploadedImageBase64) {
                const mimeType = uploadedImageBase64.substring(uploadedImageBase64.indexOf(":") + 1, uploadedImageBase64.indexOf(";"));
                const imageData = uploadedImageBase64.split(',')[1];
                parts.unshift({ inlineData: { mimeType, data: imageData } });
                 // 為了簡潔，此處省略了完整的 instruction，但後端仍會使用完整的版本
                parts[1].text = `**Crucial Instruction:** The character's appearance (face, hairstyle, clothes) MUST be identical to the provided reference image. Use the following text ONLY for the character's action, expression, and the scene's context. DO NOT change the character's appearance based on the text description. \n\n**Context:** ${prompt}`;
            } else {
                parts[0].text = prompt;
            }

            const imageResult = await imageGenModel.generateContent({ contents: [{ parts }] });
            const generatedBase64 = imageResult.response.candidates[0].content.parts.find(p => p.inlineData)?.inlineData.data;

            if (!generatedBase64) {
                 throw new Error(`第 ${panel.panel || panel.panel_number || 'N/A'} 格圖片生成失敗，AI 未返回圖片資料。`);
            }
            panelImages.push(`data:image/png;base64,${generatedBase64}`);
        }

        // --- 3. 將結果回傳給前端 ---
        res.status(200).json({ script, panelImages });

    } catch (error) {
        console.error('後端錯誤:', error);
        res.status(500).json({ error: error.message });
    }
}

