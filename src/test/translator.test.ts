import { describe, expect, it } from 'vitest';
import { validateNewsTitleTranslation } from '@/lib/translator';

describe('validateNewsTitleTranslation', () => {
  const longEnglish =
    'Researchers caught in the crossfire of geopolitical tensions over international collaboration';

  it('accepts short Chinese headlines for long English titles', () => {
    expect(validateNewsTitleTranslation('研究人员陷入地缘政治紧张局势', longEnglish)).toBe(true);
  });

  it('accepts titles that keep English proper nouns alongside Chinese', () => {
    expect(
      validateNewsTitleTranslation('CRISPR基因编辑在临床试验中取得进展', 'CRISPR gene editing shows promise in trial')
    ).toBe(true);
  });

  it('rejects empty, garbled, or untranslated English-only output', () => {
    expect(validateNewsTitleTranslation('', longEnglish)).toBe(false);
    expect(validateNewsTitleTranslation('aaaaaa', longEnglish)).toBe(false);
    expect(validateNewsTitleTranslation(longEnglish, longEnglish)).toBe(false);
    expect(validateNewsTitleTranslation('直接翻译成中文', longEnglish)).toBe(false);
  });
});
