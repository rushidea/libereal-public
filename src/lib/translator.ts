interface TranslationResult {
  translatedText: string;
  originalText: string;
}

const MINIMAX_API_URL = 'https://api.minimaxi.com/anthropic/v1/messages';

function containsGarbled(text: string): boolean {
  if (/(.)\1{5,}/.test(text)) return true;
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) return true;
  if (/[\uFFFE\uFFFF]/.test(text)) return true;
  return false;
}

function cleanText(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTextFromResponse(data: unknown): string {
  try {
    const d = data as { content?: unknown };
    const content = d.content;
    if (!content || !Array.isArray(content)) return '';

    const texts = (content as Array<{ type: string; text?: unknown }>).filter((c) => c.type === 'text');
    if (texts.length === 0) return '';

    const lastText = texts[texts.length - 1].text;
    return typeof lastText === 'string' ? lastText.trim() : '';
  } catch {
    return '';
  }
}

function isValidTranslation(text: string, original: string): boolean {
  if (!text || text.length === 0) return false;
  if (containsGarbled(text)) return false;
  if (text === original) return false;
  if (text.includes('直接翻译') || text.includes('不要解释')) return false;
  if (text.length < original.length * 0.2) return false;
  return true;
}

/** Relaxed QC for JBR / Nature / Science headlines (Chinese is often much shorter). */
export function validateNewsTitleTranslation(text: string, _original: string): boolean {
  if (!text || text.length < 2) return false;
  if (containsGarbled(text)) return false;
  if (text.includes('直接翻译') || text.includes('不要解释')) return false;
  if (!/[\u4e00-\u9fa5]/.test(text)) return false;
  return true;
}

type TranslateOptions = {
  /** Use relaxed validation for English science news headlines. */
  newsTitle?: boolean;
};

function passesTranslationValidation(
  text: string,
  original: string,
  options?: TranslateOptions
): boolean {
  return options?.newsTitle
    ? validateNewsTitleTranslation(text, original)
    : isValidTranslation(text, original);
}

function passesProofreadValidation(
  corrected: string,
  draft: string,
  original: string,
  options?: TranslateOptions
): boolean {
  if (!passesTranslationValidation(corrected, original, options)) return false;
  const lengthRatio = corrected.length / draft.length;
  if (options?.newsTitle) {
    return lengthRatio >= 0.1 && lengthRatio <= 6;
  }
  return lengthRatio > 0.3 && lengthRatio < 3;
}

function salvageNewsTitleDraft(draft: string): string | null {
  if (draft.length < 2) return null;
  if (containsGarbled(draft)) return null;
  if (!/[\u4e00-\u9fa5]/.test(draft)) return null;
  if (draft.includes('直接翻译') || draft.includes('不要解释')) return null;
  return draft;
}

export async function translateToChinese(
  text: string,
  options?: TranslateOptions
): Promise<TranslationResult> {
  const cleanedText = cleanText(text);
  if (!cleanedText || cleanedText.trim().length === 0) {
    return { translatedText: text, originalText: '' };
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.warn('[Translator] MINIMAX_API_KEY not set, returning original text');
    return { translatedText: text, originalText: '' };
  }

  try {
    const translateResponse = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        thinking: { type: 'disabled' },
        messages: [
          { role: 'user', content: `直接翻译成中文，不要解释：\n\n${cleanedText}` }
        ],
        max_tokens: 800,
        temperature: 0.3,
      }),
    });

    if (!translateResponse.ok) {
      const errorText = await translateResponse.text();
      console.error('[Translator] MiniMax API error:', translateResponse.status, errorText);
      return { translatedText: text, originalText: '' };
    }

    const translateData = await translateResponse.json();
    const draftTranslation = extractTextFromResponse(translateData);

    if (!passesTranslationValidation(draftTranslation, cleanedText, options)) {
      const salvaged = options?.newsTitle ? salvageNewsTitleDraft(draftTranslation) : null;
      if (salvaged) {
        console.warn('[Translator] Draft title failed QC, using salvaged draft:', salvaged);
        return { translatedText: salvaged, originalText: cleanedText };
      }
      console.warn('[Translator] Draft translation invalid, skipping proofread:', draftTranslation);
      return { translatedText: text, originalText: cleanedText };
    }

    const proofreadResponse = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        thinking: { type: 'disabled' },
        messages: [
          { role: 'user', content: `校对并修正以下翻译中的错误、乱码、重复内容和不合理表达。直接返回修正后的中文，不要解释，不要添加任何标记符号：\n\n${draftTranslation}` }
        ],
        max_tokens: 1000,
        temperature: 0.2,
      }),
    });

    let finalTranslation = draftTranslation;
    if (proofreadResponse.ok) {
      const proofreadData = await proofreadResponse.json();
      const corrected = extractTextFromResponse(proofreadData);
      if (passesProofreadValidation(corrected, draftTranslation, cleanedText, options)) {
        finalTranslation = corrected;
      } else {
        console.warn('[Translator] Proofread rejected, keeping draft');
      }
    }

    return {
      translatedText: finalTranslation,
      originalText: cleanedText,
    };
  } catch (error) {
    console.error('[Translator] Translation error:', error);
    return { translatedText: text, originalText: '' };
  }
}

export async function translateBatch(items: Array<{ title: string; description: string }>): Promise<Array<{ title: string; description: string; titleEn?: string; descEn?: string }>> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return items.map(item => ({ ...item }));
  }

  try {
    const results = await Promise.all(
      items.map(async (item) => {
        const cleanTitle = cleanText(item.title);
        const cleanDesc = cleanText(item.description.slice(0, 300));
        
        const [titleResult, descResult] = await Promise.all([
          translateToChinese(cleanTitle, { newsTitle: true }),
          translateToChinese(cleanDesc),
        ]);

        return {
          title: titleResult.translatedText || cleanTitle,
          description: descResult.translatedText || cleanDesc,
          titleEn: titleResult.originalText || undefined,
          descEn: descResult.originalText || undefined,
        };
      })
    );

    return results;
  } catch (error) {
    console.error('[Translator] Batch translation error:', error);
    return items.map(item => ({ ...item }));
  }
}